import React, {
    useState,
    useMemo,
    useRef,
    useCallback,
    useEffect,
    CSSProperties,
    KeyboardEvent,
    forwardRef,
    useImperativeHandle
} from 'react';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';
import './TreeView.css'; // Ensure this CSS file is available and styled

// --- Type Definitions ---

export interface TreeNodeData {
  id: string;
  name: string;
  hasChildren: boolean;
  children: TreeNodeData[] | null;
  type?: 'folder' | 'file' | string;
  icon?: string;
  [key: string]: any;
}

// --- TreeNode Class ---
class TreeNode implements TreeNodeData {
    id: string;
    name: string;
    hasChildren: boolean;
    children: TreeNode[] | null;
    type?: string;
    icon?: string;
    [key: string]: any;

    constructor(data: TreeNodeData) {
        this.id = data.id;
        this.name = data.name;
        this.hasChildren = data.hasChildren;
        // Recursively create TreeNode instances for children if data exists
        this.children = Array.isArray(data.children)
            ? data.children.map(childData => new TreeNode(childData))
            : null;
        this.type = data.type;
        this.icon = data.icon;

        // Copy any other arbitrary properties from the data source
        for (const key in data) {
            if (!['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key)) {
                 this[key] = data[key];
            }
        }
    }

    // Example getter
    get isFolder(): boolean { return this.type === 'folder'; }

    // Creates a new TreeNode instance with updated children (maintaining immutability)
    withChildren(newChildren: TreeNode[] | null): TreeNode {
        const updatedNode = this.clone(); // Start with a clone of current node
        updatedNode.children = newChildren;
        updatedNode.hasChildren = Array.isArray(newChildren) && newChildren.length > 0;
        return updatedNode;
    }

    // Creates a clone of the current node, optionally applying overrides (maintaining immutability)
    clone(overrides: Partial<TreeNodeData> = {}): TreeNode {
        // Create raw data from current instance properties, excluding children array of instances
        const currentData = { ...this };
        delete currentData.children; // Avoid spreading the potentially large children array instance

        // Construct raw data for the new TreeNode, applying overrides
        const rawData: TreeNodeData = {
            ...currentData, // Spread existing properties (id, name, type, icon, custom fields etc.)
            children: null, // Children handled specifically below
            ...overrides, // Apply any overrides provided
        };

        // Create the base cloned node instance using the constructor
        const clonedNode = new TreeNode(rawData); // Constructor handles basic props + overrides' basic props

        // Handle children specifically based on overrides or original state
        if (overrides.children === null) {
             // Explicitly set children to null in overrides
            clonedNode.children = null;
            clonedNode.hasChildren = overrides.hasChildren ?? false; // Respect override for hasChildren if provided
        } else if (Array.isArray(overrides.children)) {
             // Children were provided in overrides (assumed as raw TreeNodeData)
             // The constructor already handled converting these raw data children
             clonedNode.children = clonedNode.children; // Already set by constructor
             clonedNode.hasChildren = Array.isArray(clonedNode.children) && clonedNode.children.length > 0;
        } else if (!overrides.children && Array.isArray(this.children)) {
             // Children weren't overridden, shallow copy the existing children array of TreeNode instances
             clonedNode.children = [...this.children];
             clonedNode.hasChildren = clonedNode.children.length > 0;
        } else {
             // Default case: no children override, no original children array, or children were not array
             clonedNode.children = null;
             // Respect hasChildren override if present, otherwise keep original
             clonedNode.hasChildren = overrides.hasChildren ?? this.hasChildren;
        }

        return clonedNode;
    }
}

// --- Flat Node Structure for Rendering ---
interface FlatTreeNode {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean; // Whether it *currently* should show expansion UI (might have loaded empty children)
  originalHasChildren: boolean; // From the original data, used to know if fetch is needed
  isLoaded: boolean; // Whether children have been fetched/set at least once
  isLoadingChildren: boolean; // Whether children are currently being fetched
  isOpen: boolean; // Whether the node is expanded in the UI
  type?: string;
  icon?: string;
}

// --- Props for the Internal TreeNodeComponent ---
interface TreeNodeComponentProps {
  node: FlatTreeNode;
  style: CSSProperties; // Style from the virtualizer for positioning
  selectedNodeId: string | null;
  nodeIndex: number;
  isMoveTargetCandidate: boolean; // For drag/drop UI indication
  onToggle: (node: FlatTreeNode) => void; // Callback to expand/collapse
  onSelect: (nodeId: string, nodeIndex: number) => void; // Callback for single node selection
  showCheckboxes?: boolean; // Whether to show checkboxes
  isChecked: boolean; // Current checked state of this node
  isIndeterminate?: boolean; // Current indeterminate state of this node
  onCheckboxChange: (nodeId: string) => void; // Callback for checkbox state change
}

// --- Imperative API Handle Definition ---
// Defines methods callable on the component instance via a ref
export interface TreeViewHandle {
    addNode: (newNodeData: TreeNodeData, parentId?: string | null) => boolean;
    removeNode: (nodeId: string) => boolean;
    updateNode: (nodeId: string, updatedData: Partial<TreeNodeData>) => boolean;
    getNodeHierarchy: (nodeId: string) => string[] | null;
    expandNode: (nodeId: string, recursive?: boolean) => Promise<void>;
    collapseNode: (nodeId: string, recursive?: boolean) => void;
    selectNode: (nodeId: string | null) => void;
    getCheckedNodes: () => string[]; // Get IDs of currently checked nodes
    setCheckedNodes: (nodeIds: string[]) => void; // Programmatically set checked nodes
}

// --- Helper Functions (Internal) ---

// Builds a Map for quick ID-to-TreeNode instance lookup. Crucial for performance.
const buildNodeMap = (nodes: TreeNode[] | null): Map<string, TreeNode> => {
    const map = new Map<string, TreeNode>();
    const traverse = (nodeList: TreeNode[] | null) => {
        if (!Array.isArray(nodeList)) return;
        for (const node of nodeList) {
            if (node) {
                map.set(node.id, node);
                traverse(node.children); // Recursively map children
            }
        }
    };
    traverse(nodes);
    return map;
};

// Finds a node instance and its ancestor path by ID within the hierarchical structure.
const findNodeAndPath = (
    nodes: TreeNode[] | null,
    nodeId: string,
    currentPath: string[] = []
): { nodeData: TreeNode | null, path: string[] | null } => {
    if (!Array.isArray(nodes)) return { nodeData: null, path: null };
    for (const node of nodes) {
        if (!node) continue;
        if (node.id === nodeId) {
            // Node found, return it and the path accumulated so far
            return { nodeData: node, path: currentPath };
        }
        // Recurse into children if they exist
        if (Array.isArray(node.children)) {
            const result = findNodeAndPath(node.children, nodeId, [...currentPath, node.id]); // Add current node ID to path for children
            if (result.nodeData) {
                // If found in children, propagate the result up
                return result;
            }
        }
    }
    // Not found in this branch
    return { nodeData: null, path: null };
};

// Helper specifically for finding *loaded* descendants for cascading checks using the nodeMap.
const findAllLoadedDescendantIds = (
    startNodeId: string,
    nodeMap: Map<string, TreeNode>
): string[] => {
    const descendantIds: string[] = [];
    const queue: string[] = [startNodeId]; // Use IDs for the queue
    const visited: Set<string> = new Set();

    while (queue.length > 0) {
        const currentId = queue.shift();
        // Skip if ID is invalid or already processed
        if (!currentId || visited.has(currentId)) continue;

        visited.add(currentId);
        descendantIds.push(currentId); // Add the valid ID to results

        const node = nodeMap.get(currentId); // Get the node instance from the map
        // Only traverse children if the node exists in the map and its children array is present (loaded)
        if (node && Array.isArray(node.children)) {
            node.children.forEach(child => {
                // Add child ID to queue if it exists and hasn't been visited
                if (child && !visited.has(child.id)) {
                    queue.push(child.id);
                }
            });
        }
    }
    return descendantIds;
};

// Original helper, potentially used by collapseNode (kept separate). Finds all descendant IDs based on parent ID and map.
const findAllDescendantIds = (
    nodes: TreeNode[] | null, // Original tree structure (can be null) - needed for starting point if parent is root
    parentId: string,
    allNodesMap: Map<string, TreeNode>
): string[] => {
    const parentNode = allNodesMap.get(parentId);
    // If parent node doesn't exist in map or has no loaded children, return empty array
    if (!parentNode || !Array.isArray(parentNode.children)) { return []; }

    let descendantIds: string[] = [];
    // Start queue with direct children instances from the parent node
    const queue: TreeNode[] = [...parentNode.children];

    while (queue.length > 0) {
        const current = queue.shift();
        if (current) {
            descendantIds.push(current.id); // Add current node's ID

            // Get the full node data from the map to check for its children
            const fullCurrentNode = allNodesMap.get(current.id);
            if (fullCurrentNode && Array.isArray(fullCurrentNode.children)) {
                // Add grandchildren instances to the queue
                queue.push(...fullCurrentNode.children);
            }
        }
    }
    return descendantIds;
};

// Immutably updates a node's children after they have been fetched.
const updateNodeInChildren = (
    nodes: TreeNode[] | null,
    nodeId: string,
    newChildrenData: TreeNodeData[] // Children are raw data here
): TreeNode[] | null => {
  if (!Array.isArray(nodes)) return nodes; // Return original if not an array

  let changed = false; // Flag to track if any modification happened
  const newNodes = nodes.map((node): TreeNode => {
    if (!node) return node; // Skip null nodes if any
    if (node.id === nodeId) {
      // Found the node to update
      // Convert raw children data to TreeNode instances
      const newChildrenInstances = newChildrenData.map(childData => new TreeNode(childData));
      changed = true; // Mark as changed
      // Return a new instance of the parent node with the new children
      return node.withChildren(newChildrenInstances);
    } else if (node.children && node.children.length > 0) {
      // Node not found at this level, recurse into its children
      const updatedChildrenInstances = updateNodeInChildren(node.children, nodeId, newChildrenData);
      // If recursion resulted in a change to children
      if (updatedChildrenInstances !== node.children) {
        changed = true; // Mark as changed
        // Return a new instance of the parent node with the updated children array
        return node.withChildren(updatedChildrenInstances);
      }
    }
    // Return the original node instance if no changes occurred in this branch
    return node;
  });
  // Return the new array only if changes occurred, otherwise return the original array reference
  return changed ? newNodes : nodes;
};

// Converts the hierarchical TreeNode structure into a flat list suitable for the virtualizer.
const flattenTree = (
    nodes: TreeNode[] | null, // The current hierarchical tree data
    openNodes: Set<string>,   // Set of IDs of nodes that are currently expanded
    depth = 0,                // Current nesting depth
    loadingChildren: Set<string> // Set of IDs of nodes currently fetching children
): FlatTreeNode[] => {
  let flatList: FlatTreeNode[] = [];
  if (!Array.isArray(nodes)) return flatList; // Return empty if no nodes

  nodes.forEach((node: TreeNode | null) => {
    if (!node) return; // Skip null nodes

    const isOpen = openNodes.has(node.id);
    const isLoading = loadingChildren.has(node.id);
    // A node's children are considered "loaded" if the children property is an array (even if empty)
    const isLoaded = Array.isArray(node.children);
    // Determine if the node should visually show expand/collapse toggle
    // It has children if original data said so, OR if it's loaded and the children array is not empty
    const effectiveHasChildren = node.hasChildren || (isLoaded && node.children!.length > 0);

    // Create the flat node representation for rendering
    const flatNode: FlatTreeNode = {
      id: node.id,
      name: node.name,
      depth: depth,
      hasChildren: effectiveHasChildren, // Used for rendering toggle
      originalHasChildren: node.hasChildren, // Used to know if fetch is needed
      isLoaded: isLoaded,
      isLoadingChildren: isLoading,
      isOpen: isOpen,
      type: node.type,
      icon: node.icon,
    };
    flatList.push(flatNode);

    // If the node is open AND its children are loaded AND it actually has children, recurse
    if (isOpen && isLoaded && Array.isArray(node.children) && node.children.length > 0) {
      flatList = flatList.concat(flattenTree(node.children, openNodes, depth + 1, loadingChildren));
    }
  });
  return flatList;
};

// Immutably adds a new node under the parent specified by the path array.
const addNodeAtPath = (
    nodes: TreeNode[] | null, // Current tree structure
    path: string[],          // Array of ancestor IDs leading to the parent (empty for root)
    newNodeInput: Partial<TreeNodeData> & { id: string; name: string } // Data for the new node
): TreeNode[] | null => {
    if (!Array.isArray(nodes)) {
       // If adding to an empty tree at root level
       if (path.length === 0) {
            const newNodeInstance = new TreeNode({ hasChildren: false, children: null, type: 'file', icon: '📄', ...newNodeInput });
            return [newNodeInstance];
       }
       return nodes; // Cannot add if tree is null and path is not root
    }

    // Create the new TreeNode instance from the input data
    const newNodeInstance = new TreeNode({ hasChildren: false, children: null, type: 'file', icon: '📄', ...newNodeInput });

    // If adding to the root level
    if (path.length === 0) {
        return [...nodes, newNodeInstance]; // Return new array with the node added
    }

    let changed = false; // Flag to track if modification occurs

    // Recursive function to traverse the path and add the node
    const updateRecursively = (
        currentNodes: TreeNode[] | null,
        currentPath: string[]
    ): TreeNode[] | null => {
        if (!Array.isArray(currentNodes)) return currentNodes; // Should not happen if initial check passed, but safety

        const parentId = currentPath[0]; // ID of the node to find at this level
        const remainingPath = currentPath.slice(1); // Path remaining after this level
        let listChanged = false; // Flag for changes at this specific level

        const mappedNodes = currentNodes.map(node => {
            if (!node) return node;
            if (node.id === parentId) {
                // Found the node corresponding to the current path segment
                if (remainingPath.length === 0) {
                    // This is the direct parent where the new node should be added
                    if (Array.isArray(node.children)) {
                        // Ensure children array exists and is loaded
                        const newChildren = [...node.children, newNodeInstance];
                        listChanged = true;
                        changed = true;
                        // Return a new instance of the parent with updated children
                        return node.withChildren(newChildren);
                    } else {
                        // Cannot add if children are not loaded (null) or not an array
                        console.warn(`Cannot add node. Parent ${node.id} children not loaded or not an array.`);
                        return node; // Return node unchanged
                    }
                } else {
                    // Need to go deeper into this node's children
                    const updatedChildren = updateRecursively(node.children, remainingPath);
                    // If recursion changed the children array
                    if (updatedChildren !== node.children) {
                        listChanged = true;
                        changed = true;
                        // Return a new instance of the parent with updated children
                        return node.withChildren(updatedChildren);
                    }
                }
            }
            // If this node is not the target at this level, return it unchanged
            return node;
        });

        // Return the new array only if changes occurred at this level
        return listChanged ? mappedNodes : currentNodes;
    };

    const finalTree = updateRecursively(nodes, path);
    // Return the potentially modified tree only if overall changes occurred
    return changed ? finalTree : nodes;
};

// Immutably finds and removes a node by its ID. Returns the modified tree and the removed node instance.
const findAndRemoveNode = (
    nodes: TreeNode[] | null,
    nodeIdToRemove: string
): { updatedTree: TreeNode[] | null, removedNode: TreeNode | null } => {
    if (!Array.isArray(nodes)) return { updatedTree: nodes, removedNode: null };

    let removedNode: TreeNode | null = null; // To store the instance of the removed node
    let treeChanged = false; // Flag if any change occurs

    // Recursive function to process a list of nodes
    const processNodeList = (nodeList: TreeNode[]): TreeNode[] | null => { // Can return null if list becomes empty
        const nodeIndex = nodeList.findIndex(node => node?.id === nodeIdToRemove);

        if (nodeIndex !== -1) {
            // Node found at this level
            removedNode = nodeList[nodeIndex]; // Store the node being removed
            const updatedList = [...nodeList]; // Clone the list
            updatedList.splice(nodeIndex, 1); // Remove the node
            treeChanged = true;
            // Return the updated list, or null if the list becomes empty
            return updatedList.length === 0 ? null : updatedList;
        }

        // Node not found at this level, recurse into children
        let listChangedInRecursion = false;
        const mappedList = nodeList.map(node => {
            if (!node || removedNode) return node; // Stop searching if already found, or skip null nodes

            if (Array.isArray(node.children)) {
                const originalChildren = node.children;
                const updatedChildren = processNodeList(originalChildren); // Recurse

                // If recursion changed the children array (or made it null)
                if (updatedChildren !== originalChildren) {
                    listChangedInRecursion = true;
                    // Return a new parent instance with updated children
                    return node.withChildren(updatedChildren);
                }
            }
            // Return original node if no changes in its branch
            return node;
        });

        // If recursion caused changes, mark the overall tree as changed
        if (listChangedInRecursion) {
            treeChanged = true;
            return mappedList; // Return the list with updated nodes
        }

        // No changes at this level or below
        return nodeList;
    };

    const finalTree = processNodeList(nodes);

    // Return the final tree structure (which could be null if root was removed)
    // and the node that was removed (or null if not found)
    return { updatedTree: treeChanged ? finalTree : nodes, removedNode };
};

// Immutably updates the data of a specific node using its ID.
const updateNodeData = (
    nodes: TreeNode[] | null,
    nodeId: string,
    updatedData: Partial<TreeNodeData> // Data fields to update
): { updatedTree: TreeNode[] | null, success: boolean } => {
    if (!Array.isArray(nodes)) return { updatedTree: nodes, success: false };

    let changed = false; // Flag if update occurs

    // Recursive function to process node list
    const processList = (nodeList: TreeNode[]): TreeNode[] => {
        let listChanged = false; // Flag for changes at this level
        const mappedList = nodeList.map(node => {
            if (!node) return node;

            if (node.id === nodeId) {
                // Found the node to update
                changed = true; // Mark overall change
                listChanged = true; // Mark change at this level
                const { id, children, ...restOfUpdates } = updatedData; // Exclude ID and children from direct override (use withChildren/clone logic)
                // Use clone with overrides for other properties
                return node.clone(restOfUpdates);
            }

            // Recurse if children exist
            if (Array.isArray(node.children)) {
                const originalChildren = node.children;
                const updatedChildren = processList(originalChildren);
                if (updatedChildren !== originalChildren) {
                    listChanged = true;
                    // Return new parent instance with updated children list reference
                    return node.withChildren(updatedChildren);
                }
            }
            // Return original node if not the target and no children changed
            return node;
        });
        // Return new list instance only if changes occurred at this level
        return listChanged ? mappedList : nodeList;
    };

    const finalTree = processList(nodes);
    // Return the potentially updated tree and success status
    return { updatedTree: changed ? finalTree : nodes, success: changed };
};


// --- TreeNodeComponent (Internal Rendering Component - Final Version) ---
const TreeNodeComponent: React.FC<TreeNodeComponentProps> = React.memo(({
    node, style, selectedNodeId, nodeIndex, isMoveTargetCandidate,
    showCheckboxes, isChecked, isIndeterminate, onCheckboxChange,
    onToggle, onSelect
}) => {
    const checkboxRef = useRef<HTMLInputElement>(null); // Ref for the checkbox input

    // Effect to set the indeterminate property on the DOM element, as it's not a standard React prop
    useEffect(() => {
        if (checkboxRef.current) {
            checkboxRef.current.indeterminate = isIndeterminate ?? false;
        }
    }, [isIndeterminate]); // Run only when isIndeterminate changes

    const isCurrentlySelected = node.id === selectedNodeId; // Is this row highlighted?

    // Handlers
    const handleToggleClick = (e: React.MouseEvent<HTMLSpanElement>) => { e.stopPropagation(); onToggle(node); };
    const handleContentClick = () => { onSelect(node.id, nodeIndex); }; // Click on row selects node
    const handleCheckboxClick = (e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); }; // Prevent row selection when clicking checkbox itself
    const handleCheckboxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation(); // Prevent event bubbling
        onCheckboxChange(node.id); // Trigger the state update handler
    };

    return (
        <div
            role="treeitem"
            aria-selected={isCurrentlySelected}
            // Set aria-checked based on state: 'true', 'false', or 'mixed'
            aria-checked={showCheckboxes ? (isIndeterminate ? 'mixed' : isChecked) : undefined}
            aria-expanded={node.hasChildren ? node.isOpen : undefined}
            className={`tree-node ${isCurrentlySelected ? 'selected' : ''} ${isMoveTargetCandidate ? 'move-target-candidate' : ''}`}
            style={style} // Apply virtualizer styles
            onClick={handleContentClick}
            id={`tree-node-${node.id}`} // Unique ID for the element
        >
            <div className="node-content">
                {/* Indentation based on depth */}
                <div className="indent-lines">
                    {Array.from({ length: node.depth }).map((_, i) => ( <span key={i} className="indent-line"></span> ))}
                </div>

                {/* Expand/Collapse Toggle */}
                {node.hasChildren ? (
                    <span className={`toggle ${node.isOpen ? 'open' : 'closed'}`} onClick={handleToggleClick}>
                        {node.isLoadingChildren ? <span className="spinner"></span> : (node.isOpen ? '▼' : '▶')}
                    </span>
                ) : (
                    // Placeholder for alignment when no toggle is needed
                    <span className="toggle placeholder"></span>
                )}

                 {/* Checkbox (Conditionally Rendered) */}
                 {showCheckboxes && (
                    <input
                        ref={checkboxRef} // Attach ref
                        type="checkbox"
                        className="node-checkbox"
                        checked={isChecked} // Controlled component: checked state from props
                        onClick={handleCheckboxClick} // Stop click propagation
                        onChange={handleCheckboxInputChange} // Handle state changes
                        aria-labelledby={`tree-node-name-${node.id}`} // Accessibility: links to node name
                        tabIndex={-1} // Avoid individual tab stop for checkbox if row itself is focusable
                    />
                 )}

                {/* Icon */}
                {node.icon && <span className="node-icon">{node.icon}</span>}

                {/* Node Name */}
                <span className="node-name" id={`tree-node-name-${node.id}`}>{node.name}</span>
            </div>
        </div>
    );
});
TreeNodeComponent.displayName = 'TreeNodeComponent'; // For React DevTools


// --- Props for the main VirtualizedTreeView component ---
export interface VirtualizedTreeViewProps {
    // Required functions to fetch data
    fetchTopLevelNodes: () => Promise<TreeNodeData[]>;
    fetchChildrenForNode: (parentId: string) => Promise<TreeNodeData[]>;

    // Optional callbacks
    onNodeSelect?: (nodeId: string | null, nodeData: TreeNodeData | null) => void; // When a node row is selected/deselected
    onError?: (error: Error | string) => void; // If an error occurs during fetch etc.
    onCheckedNodesChange?: (checkedIds: Set<string>) => void; // When checkbox selection changes

    // Optional initial state and configuration
    initialSelectedNodeId?: string | null;
    initialCheckedNodeIds?: string[]; // Initial IDs for checked nodes
    showCheckboxes?: boolean; // Master toggle for the checkbox feature
    hideDefaultControls?: boolean; // Option to hide built-in Move/Add buttons

    // Optional styling
    containerStyle?: CSSProperties;
    containerClassName?: string;
}

// --- Mock API Functions (Example implementations) ---
const exampleFetchTopLevelNodes = (): Promise<TreeNodeData[]> => {
  console.log("API: Fetching top-level nodes...");
  return new Promise((resolve) => {
    setTimeout(() => {
      const mockData: TreeNodeData[] = [
        { id: 'node-A', name: 'Node A (Folder)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
        { id: 'node-B', name: 'Node B (File)', hasChildren: false, children: [], type: 'file', icon: '📄' },
        { id: 'node-C', name: 'Node C (Folder)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
        ...Array.from({ length: 300 }, (_, i): TreeNodeData => { // Example with more nodes
            const hasChildren = Math.random() > 0.5;
            return { id: `node-Top-${i}`, name: `Top Level ${hasChildren ? 'Folder' : 'Item'} ${i + 1}`, hasChildren: hasChildren, children: null, type: hasChildren ? 'folder' : 'file', icon: hasChildren ? '📁' : '📄' }
        })
      ];
       console.log("API: Fetched top-level nodes.");
      resolve(mockData);
    }, 1000); // Simulate network delay
  });
};

const exampleFetchChildrenForNode = (parentId: string): Promise<TreeNodeData[]> => {
 console.log(`API: Fetching children for node ${parentId}...`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      let children: TreeNodeData[] = [];
      // Example logic for specific parent IDs
      if (parentId === 'node-A') { children = [ { id: 'node-A-1', name: 'Node A.1 (File)', hasChildren: false, children: [], type: 'file', icon: '📄' }, { id: 'node-A-2', name: 'Node A.2 (Folder) - Also has a long name to test scrolling', hasChildren: true, children: null, type: 'folder', icon: '📁' }, ]; }
      else if (parentId === 'node-C') { children = [ { id: 'node-C-1', name: 'Node C.1 (File)', hasChildren: false, children: [], type: 'file', icon: '📄' }, ]; }
      else if (parentId === 'node-A-2') { children = [ { id: 'node-A-2-1', name: 'Node A.2.1 (File) - Deeply nested and also quite long', hasChildren: false, children: [], type: 'file', icon: '📄' }, ]; }
      // Example logic for dynamically generated nodes
      else if (parentId.startsWith('node-Top-')) {
         const parentIndex = parseInt(parentId.split('-')[2], 10);
         // Only give children to some dynamic nodes
         if (parentIndex % 3 === 0) { children = Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i): TreeNodeData => { const hasSubChildren = Math.random() > 0.8; return { id: `${parentId}-${i}`, name: `Sub ${hasSubChildren ? 'Folder' : 'File'} ${parentIndex + 1}.${i + 1} with extra text`, hasChildren: hasSubChildren, children: null, type: hasSubChildren ? 'folder' : 'file', icon: hasSubChildren ? '📁' : '📄', }; }); }
         else { children = []; } // Others have no children
      }
      // Default case: return empty array
      else { children = []; }
       console.log(`API: Fetched ${children.length} children for node ${parentId}.`);
      resolve(children);
    }, 800); // Simulate network delay
  });
};


// --- VirtualizedTreeView Component (Main Exported Component) ---
const VirtualizedTreeView = forwardRef<TreeViewHandle, VirtualizedTreeViewProps>(({
    // Destructure props with defaults
    fetchTopLevelNodes: fetchTopLevelNodesProp = exampleFetchTopLevelNodes,
    fetchChildrenForNode: fetchChildrenForNodeProp = exampleFetchChildrenForNode,
    onNodeSelect,
    onError: onErrorCallback,
    initialSelectedNodeId = null,
    containerStyle,
    containerClassName,
    hideDefaultControls = false,
    // Checkbox related props
    showCheckboxes = false,
    initialCheckedNodeIds = [],
    onCheckedNodesChange,
}, ref) => {

  // --- State ---
  const [treeData, setTreeData] = useState<TreeNode[] | null>(null); // Holds the hierarchical data structure
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true); // Loading state for initial fetch
  const [error, setError] = useState<string | null>(null); // Stores error messages
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set()); // IDs of expanded nodes
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set()); // IDs of nodes currently fetching children
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialSelectedNodeId); // ID of the currently selected node (row highlight)
  const [nodeToMove, setNodeToMove] = useState<TreeNode | null>(null); // Stores node instance during move operation
  const [checkedNodes, setCheckedNodes] = useState<Set<string>>( // IDs of checked nodes
    () => new Set(initialCheckedNodeIds) // Initialize from prop
  );

  // --- Refs ---
  const parentRef = useRef<HTMLDivElement>(null); // Ref for the scrollable container

  // --- Memoized Derived State ---
  // Create a map for fast node lookups by ID, recalculated only when treeData changes
  const nodeMap = useMemo(() => buildNodeMap(treeData), [treeData]);
  // Create the flat list for rendering, recalculated when relevant state changes
  const flatNodes: FlatTreeNode[] = useMemo(() => {
     return flattenTree(treeData, openNodes, 0, loadingChildren);
  }, [treeData, openNodes, loadingChildren]);

  // --- Callbacks and Effects ---

  // Generic error handler
  const handleError = useCallback((err: any, context: string) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error ${context}:`, err);
      setError(errorMessage); // Set error state for display
      if (onErrorCallback) { onErrorCallback(err instanceof Error ? err : errorMessage); } // Call external callback
  }, [onErrorCallback]);

  // Effect to fetch initial top-level nodes
  useEffect(() => {
    // Only fetch if data hasn't been loaded yet
    if (treeData === null) {
        setIsLoadingInitial(true);
        setError(null);
        fetchTopLevelNodesProp()
            .then((data: TreeNodeData[]) => {
                const initialTreeNodes = data.map(nodeData => new TreeNode(nodeData));
                setTreeData(initialTreeNodes); // Set initial tree structure
                setOpenNodes(new Set()); // Reset open nodes
                // Set initial selection (select first node if no initial ID provided)
                if (initialSelectedNodeId === null && initialTreeNodes.length > 0) {
                    setSelectedNodeId(initialTreeNodes[0].id);
                } else {
                    setSelectedNodeId(initialSelectedNodeId);
                }
                // Ensure initial checked nodes are set based on prop
                setCheckedNodes(new Set(initialCheckedNodeIds));
            })
            .catch((err) => handleError(err, 'fetching initial nodes'))
            .finally(() => { setIsLoadingInitial(false); }); // Update loading state
    }
  }, [fetchTopLevelNodesProp, handleError, treeData, initialSelectedNodeId, initialCheckedNodeIds]); // Dependencies

  // Callback to toggle node expansion (open/close) and fetch children if needed
  const toggleNode = useCallback(async (flatNode: FlatTreeNode) => {
    const { id, isOpen, originalHasChildren, isLoaded } = flatNode;
    const newOpenNodes = new Set(openNodes);

    if (isOpen) {
        // Close node
        newOpenNodes.delete(id);
        setOpenNodes(newOpenNodes);
    } else {
        // Open node
        newOpenNodes.add(id);
        setOpenNodes(newOpenNodes);
        // Fetch children only if it's supposed to have children, they aren't loaded, and not already loading
        if (originalHasChildren && !isLoaded && !loadingChildren.has(id)) {
            setLoadingChildren(prev => new Set(prev).add(id)); // Mark as loading
            setError(null); // Clear previous errors
            try {
                const childrenData: TreeNodeData[] = await fetchChildrenForNodeProp(id);
                // Update tree data immutably with the fetched children
                setTreeData((currentTreeData): TreeNode[] | null =>
                    updateNodeInChildren(currentTreeData, id, childrenData)
                );
            } catch (err: any) {
                handleError(err, `Workspaceing children for ${id}`);
                // If fetch fails, close the node again
                newOpenNodes.delete(id);
                setOpenNodes(new Set(newOpenNodes));
            } finally {
                // Remove from loading set regardless of success/failure
                setLoadingChildren(prev => { const next = new Set(prev); next.delete(id); return next; });
            }
        }
    }
  }, [openNodes, loadingChildren, fetchChildrenForNodeProp, handleError]); // Dependencies

  // Callback for handling checkbox changes with cascading logic
  const handleCheckboxChange = useCallback((clickedNodeId: string) => {
    if (!nodeMap.size) return; // Ensure map is available

    // Determine the new intended checked state for the clicked node
    const shouldBeChecked = !checkedNodes.has(clickedNodeId);

    // 1. Update Descendants: Find all loaded descendants (including self)
    const descendantIds = findAllLoadedDescendantIds(clickedNodeId, nodeMap);
    const newCheckedNodes = new Set(checkedNodes); // Clone current checked set

    // Add or remove descendants based on the new state
    if (shouldBeChecked) {
        descendantIds.forEach(id => newCheckedNodes.add(id));
    } else {
        descendantIds.forEach(id => newCheckedNodes.delete(id));
    }

    // 2. Update Ancestors: Find the path (ancestor IDs) of the clicked node
    const { path: ancestorPath } = findNodeAndPath(treeData, clickedNodeId);

    if (ancestorPath) {
        // Iterate upwards from the direct parent to the root
        for (let i = ancestorPath.length - 1; i >= 0; i--) {
            const ancestorId = ancestorPath[i];
            const ancestorNode = nodeMap.get(ancestorId); // Get ancestor instance from map

            // Skip if ancestor not found, has no children array, or children array is empty
            if (!ancestorNode || !Array.isArray(ancestorNode.children) || ancestorNode.children.length === 0) {
                continue;
            }

            // Check the status of all direct children of this ancestor *in the new set*
            const allChildren = ancestorNode.children;
            const allChildrenChecked = allChildren.every(child => child && newCheckedNodes.has(child.id));

            // Update ancestor's state in the new set based on its children
            if (allChildrenChecked) {
                newCheckedNodes.add(ancestorId); // Check parent if all children are now checked
            } else {
                newCheckedNodes.delete(ancestorId); // Uncheck parent otherwise (if any child is unchecked)
            }
        }
    }

    // 3. Final State Update: Apply the accumulated changes
    setCheckedNodes(newCheckedNodes);
    // Notify external listeners if callback is provided
    if (onCheckedNodesChange) {
        onCheckedNodesChange(newCheckedNodes);
    }
}, [checkedNodes, nodeMap, treeData, onCheckedNodesChange]); // Dependencies

  // Callback to initiate moving a node
  const handleStartMove = useCallback(() => {
      if (!selectedNodeId) return;
      setError(null);
      const { nodeData } = findNodeAndPath(treeData, selectedNodeId); // Find the node instance
      if (nodeData) {
          setNodeToMove(nodeData); // Store the node instance to be moved
          setSelectedNodeId(null); // Deselect while moving
          console.log(`Ready to move node: ${nodeData.name} (${nodeData.id})`);
      } else {
          const errorMsg = "Could not find selected node data to move.";
          console.error(errorMsg);
          setError(errorMsg);
          handleError(new Error(errorMsg), "starting move");
      }
  }, [selectedNodeId, treeData, handleError]); // Dependencies

  // Callback to cancel the move operation
  const handleCancelMove = useCallback(() => {
      setNodeToMove(null); // Clear the node being moved
      setError(null);
      console.log("Move cancelled.");
  }, []);

  // Callback to complete the move operation to a new parent
  const handleCompleteMove = useCallback((targetParentId: string | null) => {
      if (!nodeToMove) return; // Must have a node selected to move
      setError(null);

      // Prevent moving into self
      if (nodeToMove.id === targetParentId) {
          setError("Cannot move a node into itself.");
          setNodeToMove(null); // Cancel move
          return;
      }

      // Find the target parent and its path (ancestors)
      // If targetParentId is null, it means moving to the root (path is empty array)
      const { nodeData: targetParentData, path: targetPathArray } = targetParentId
          ? findNodeAndPath(treeData, targetParentId)
          : { nodeData: null, path: [] };

      // Prevent moving into own descendant
      if (targetPathArray && targetPathArray.includes(nodeToMove.id)) {
          setError("Cannot move a node into its own descendant.");
          setNodeToMove(null); // Cancel move
          return;
      }

      // Prevent moving into a parent whose children haven't been loaded yet
      if (targetParentData && targetParentData.children === null) {
          setError(`Target parent "${targetParentData.name}" must be expanded first.`);
          // Don't cancel move here, let user try expanding first or choose another target
          return;
      }

      console.log(`Attempting to move ${nodeToMove.id} to parent ${targetParentId || 'root'}`);

      // 1. Remove the node from its original position (immutably)
      const { updatedTree: treeAfterRemove, removedNode } = findAndRemoveNode(treeData, nodeToMove.id);

      if (!removedNode) {
          // Should not happen if nodeToMove was set correctly, but safety check
          setError("Failed to find and remove the original node during move.");
          setNodeToMove(null);
          return;
      }

      // 2. Add the removed node to the new parent's location (immutably)
      // `targetPathArray` is the list of ancestors of the target parent
      const finalTree = addNodeAtPath(treeAfterRemove, targetPathArray || [], removedNode);

      // 3. Update state
      setTreeData(finalTree); // Set the new tree structure
      setNodeToMove(null); // Clear move state
      setSelectedNodeId(nodeToMove.id); // Reselect the moved node
      console.log(`Successfully moved ${nodeToMove.id} to parent ${targetParentId || 'root'}`);

  }, [nodeToMove, treeData, handleError]); // Dependencies

  // Callback for selecting a node row (or completing a move if in move mode)
  const handleSelectNode = useCallback((nodeId: string, nodeIndex: number) => {
      setError(null); // Clear errors on interaction

      if (nodeToMove) {
          // If in move mode, clicking a node means completing the move to that node as the new parent
          handleCompleteMove(nodeId);
      } else {
          // Normal selection behavior: toggle selection on the clicked node
          const newSelectedId = selectedNodeId === nodeId ? null : nodeId; // Deselect if clicked again
          setSelectedNodeId(newSelectedId);

          // Call external callback with simplified node data (no children instances)
          if (onNodeSelect) {
              if (newSelectedId) {
                  const { nodeData } = findNodeAndPath(treeData, newSelectedId);
                  // Prepare data for callback, excluding complex children objects
                  const callbackData = nodeData ? {
                      id: nodeData.id, name: nodeData.name, hasChildren: nodeData.hasChildren,
                      children: null, // Explicitly null for callback data
                      type: nodeData.type, icon: nodeData.icon,
                      // Include other arbitrary properties
                      ...Object.fromEntries(Object.entries(nodeData).filter(([key]) => !['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key)))
                   } : null;
                   onNodeSelect(newSelectedId, callbackData);
              } else {
                  // Node deselected
                  onNodeSelect(null, null);
              }
          }
      }
  }, [nodeToMove, handleCompleteMove, selectedNodeId, onNodeSelect, treeData]); // Dependencies

  // Example handler for an internal 'Add' button (adds to a predefined parent)
  const handleAddNodeInternal = () => {
      // Example: Add a new file node under 'node-A'
      const newNodeInput: Partial<TreeNodeData> & { id: string; name: string } = {
          id: `new-node-${Date.now()}`,
          name: 'Dynamically Added File',
          // Can add type, icon etc. here
      };
      const targetParentId = 'node-A'; // Example parent ID

      setError(null);
      let targetPath: string[] = [];
      if (targetParentId) {
          const { nodeData: parentNode, path: parentPath } = findNodeAndPath(treeData, targetParentId);
          if (!parentNode) {
              handleError(new Error(`Parent node with ID ${targetParentId} not found.`), 'adding node internally');
              return;
          }
          if(parentNode.children === null) {
              handleError(new Error(`Parent node ${targetParentId} children not loaded. Expand first.`), 'adding node internally');
              return;
          }
          targetPath = [...(parentPath || []), targetParentId]; // Construct full path including parent
      }
       // Update tree data; addNodeAtPath handles immutability
       const finalTree = addNodeAtPath(treeData, targetPath, newNodeInput);
       if (finalTree !== treeData) { // Check if update actually happened
           setTreeData(finalTree);
       }
  };

  // --- Virtualizer Setup ---
  const rowVirtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: flatNodes.length, // Number of items to virtualize
    getScrollElement: () => parentRef.current, // Function to get the scrollable element
    estimateSize: () => 35, // Estimated height of each row in pixels
    overscan: 5, // Render N items above/below the visible viewport
    scrollPaddingStart: 10, // Optional padding at the start
    scrollPaddingEnd: 10, // Optional padding at the end
   });

  // --- Effect to Scroll to Selected Node ---
  useEffect(() => {
      if (selectedNodeId !== null && rowVirtualizer.scrollToIndex) {
          // Find the index in the flat list corresponding to the selected ID
          const selectedIndex = flatNodes.findIndex(node => node.id === selectedNodeId);
          if (selectedIndex !== -1) {
              // Scroll the virtualizer to that index
              rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto', behavior: 'auto' });
          }
      }
      // We don't include rowVirtualizer directly in deps array as its identity can change often.
      // This effect primarily reacts to selectedNodeId changing.
  }, [selectedNodeId, flatNodes]);


  // --- Keyboard Navigation Handler ---
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (flatNodes.length === 0) return; // No nodes, nothing to navigate

      const currentSelectedIndex = selectedNodeId !== null
          ? flatNodes.findIndex(node => node.id === selectedNodeId)
          : -1;

      let nextSelectIndex: number = currentSelectedIndex; // Start with current index

      // Handle initial selection if nothing is selected
      if (currentSelectedIndex === -1 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          nextSelectIndex = event.key === 'ArrowDown' ? 0 : flatNodes.length - 1;
          if (nextSelectIndex >= 0 && nextSelectIndex < flatNodes.length) {
              handleSelectNode(flatNodes[nextSelectIndex].id, nextSelectIndex);
          }
          return; // Stop processing after initial selection
      }

      // If no node is selected (and not ArrowUp/Down), do nothing
      if (currentSelectedIndex === -1) return;

      const currentNode = flatNodes[currentSelectedIndex];
      if (!currentNode) return; // Should not happen if index is valid

      // Handle Enter/Space for selection or completing move
      if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (nodeToMove) {
              handleCompleteMove(currentNode.id); // Complete move using current node as parent
          } else {
              // Regular selection: select the node (or deselect if already selected)
              handleSelectNode(currentNode.id, currentSelectedIndex);
              // Optional: If node has children, Enter could also toggle expansion
              // if (currentNode.hasChildren) { toggleNode(currentNode); }
          }
          return;
      }

      // Handle Escape to cancel move
      if (event.key === 'Escape' && nodeToMove) {
          event.preventDefault();
          handleCancelMove();
          return;
      }

      // Handle Arrow Navigation
      switch (event.key) {
          case 'ArrowDown':
              event.preventDefault();
              nextSelectIndex = Math.min(currentSelectedIndex + 1, flatNodes.length - 1);
              break;
          case 'ArrowUp':
              event.preventDefault();
              nextSelectIndex = Math.max(currentSelectedIndex - 1, 0);
              break;
          case 'ArrowRight':
              event.preventDefault();
              if (currentNode.hasChildren) {
                  if (!currentNode.isOpen) {
                      // Open the node if closed
                      toggleNode(currentNode);
                      nextSelectIndex = currentSelectedIndex; // Stay on the current node
                  } else if (currentSelectedIndex + 1 < flatNodes.length && flatNodes[currentSelectedIndex + 1].depth > currentNode.depth) {
                      // If open, move to the first child
                      nextSelectIndex = currentSelectedIndex + 1;
                  }
              }
              break;
          case 'ArrowLeft':
              event.preventDefault();
              if (currentNode.isOpen && currentNode.hasChildren) {
                  // Close the node if open
                  toggleNode(currentNode);
                  nextSelectIndex = currentSelectedIndex; // Stay on the current node
              } else if (currentNode.depth > 0) {
                  // If closed or no children, move to the parent node
                  let parentIndex = -1;
                  for (let i = currentSelectedIndex - 1; i >= 0; i--) {
                      if (flatNodes[i].depth === currentNode.depth - 1) {
                          parentIndex = i;
                          break;
                      }
                  }
                  if (parentIndex !== -1) {
                      nextSelectIndex = parentIndex;
                  }
              }
              break;
          case 'Home': // Go to the first node
              event.preventDefault();
              nextSelectIndex = 0;
              break;
          case 'End': // Go to the last node
              event.preventDefault();
              nextSelectIndex = flatNodes.length - 1;
              break;
          default:
              return; // Ignore other keys
      }

      // Select the node determined by navigation, if it changed
      if (nextSelectIndex !== -1 && nextSelectIndex !== currentSelectedIndex) {
          handleSelectNode(flatNodes[nextSelectIndex].id, nextSelectIndex);
      }
  }, [flatNodes, selectedNodeId, nodeToMove, toggleNode, handleSelectNode, handleCompleteMove, handleCancelMove]); // Dependencies


  // --- Imperative API Implementation via useImperativeHandle ---
  useImperativeHandle(ref, (): TreeViewHandle => ({
      // --- Node Manipulation Methods ---
      addNode: (newNodeData: TreeNodeData, parentId: string | null = null): boolean => {
          setError(null);
          let targetPath: string[] = [];
          if (parentId) {
              const { nodeData: parentNode, path: parentPath } = findNodeAndPath(treeData, parentId);
              if (!parentNode) { handleError(new Error(`Parent node with ID ${parentId} not found.`), 'API addNode'); return false; }
              if (parentNode.children === null) { handleError(new Error(`Parent node ${parentId} children not loaded. Expand first.`), 'API addNode'); return false; }
              targetPath = [...(parentPath || []), parentId];
          }
          const finalTree = addNodeAtPath(treeData, targetPath, newNodeData);
          if (finalTree !== treeData) {
              setTreeData(finalTree);
              return true;
          }
          return false; // Return false if no change occurred
      },
      removeNode: (nodeId: string): boolean => {
          setError(null);
          const { updatedTree, removedNode } = findAndRemoveNode(treeData, nodeId);
          if (removedNode) {
              setTreeData(updatedTree); // Update state with the modified tree
              // If the removed node was selected, deselect it
              if (selectedNodeId === nodeId) {
                  setSelectedNodeId(null);
                  if (onNodeSelect) onNodeSelect(null, null); // Notify listener
              }
              // If the removed node was checked, update checked state (optional, depends on desired behavior)
              if (checkedNodes.has(nodeId)) {
                   // Re-run cascading logic or simply remove? Simplest is just remove.
                   const newChecked = new Set(checkedNodes);
                   newChecked.delete(nodeId);
                   // Cascading upwards after removal might be complex/unexpected, leave simple for now.
                   setCheckedNodes(newChecked);
                   if(onCheckedNodesChange) onCheckedNodesChange(newChecked);
              }
              return true; // Success
          } else {
              handleError(new Error(`Node with ID ${nodeId} not found for removal.`), 'API removeNode');
              return false; // Failure
          }
      },
      updateNode: (nodeId: string, updatedData: Partial<TreeNodeData>): boolean => {
          setError(null);
          const { id, children, ...restOfUpdates } = updatedData; // Ensure ID/Children structure isn't directly overwritten
          const { updatedTree, success } = updateNodeData(treeData, nodeId, restOfUpdates);
          if (success) {
              setTreeData(updatedTree); // Update state
              return true;
          } else {
              handleError(new Error(`Node with ID ${nodeId} not found for update.`), 'API updateNode');
              return false;
          }
      },
      // --- Read/Navigation Methods ---
      getNodeHierarchy: (nodeId: string): string[] | null => {
          const { path } = findNodeAndPath(treeData, nodeId);
          // Include the node itself in the hierarchy path
          return path ? [...path, nodeId] : null;
      },
      expandNode: async (nodeId: string, recursive: boolean = false): Promise<void> => {
         setError(null);
         const nodesToOpen = new Set<string>();
         const nodesToFetch = new Set<string>();
         const queue: string[] = [nodeId]; // Use IDs for queue
         const visited: Set<string> = new Set(); // Prevent infinite loops

         // Phase 1: Identify nodes to open and fetch
         while(queue.length > 0) {
             const currentId = queue.shift()!;
             if (visited.has(currentId)) continue;
             visited.add(currentId);

             const node = nodeMap.get(currentId);
             if (!node) continue; // Skip if node not found in map

             nodesToOpen.add(currentId); // Add to set of nodes to be opened

             // Check if children need fetching
             if (node.hasChildren && node.children === null && !loadingChildren.has(currentId)) {
                  nodesToFetch.add(currentId);
                  // If not recursive, stop descent here for nodes needing fetch
                  if (!recursive) continue;
             }

             // If recursive and children are loaded, add them to the queue
             if (recursive && Array.isArray(node.children)) {
                 node.children.forEach(child => { if (child) queue.push(child.id); });
             }
         }

         // Phase 2: Update open state
         if (nodesToOpen.size > 0) {
             setOpenNodes(prevOpenNodes => {
                 const newOpenNodes = new Set(prevOpenNodes);
                 let changed = false;
                 nodesToOpen.forEach(id => {
                     if (!newOpenNodes.has(id)) {
                         newOpenNodes.add(id);
                         changed = true;
                     }
                 });
                 return changed ? newOpenNodes : prevOpenNodes;
             });
         }

         // Phase 3: Fetch required children
         if (nodesToFetch.size > 0) {
             setLoadingChildren(prev => new Set([...prev, ...nodesToFetch])); // Mark all as loading
             try {
                 const fetchPromises = Array.from(nodesToFetch).map(idToFetch =>
                     fetchChildrenForNodeProp(idToFetch)
                         .then(childrenData => ({ id: idToFetch, childrenData })) // Return data with ID
                         .catch(err => {
                             handleError(err, `Workspaceing children for ${idToFetch} during expandNode`);
                             return { id: idToFetch, error: true }; // Mark error for this node
                         })
                 );
                 const results = await Promise.all(fetchPromises);

                 // Update tree state based on results - batch update if possible
                 setTreeData(currentTreeData => {
                     let tempTree = currentTreeData;
                     let treeChanged = false;
                     results.forEach(result => {
                         if (!result.error && result.childrenData) {
                             const updated = updateNodeInChildren(tempTree, result.id, result.childrenData);
                             if (updated !== tempTree) {
                                 tempTree = updated;
                                 treeChanged = true;
                             }
                         }
                     });
                     return treeChanged ? tempTree : currentTreeData; // Return new tree only if changed
                 });

             } finally {
                  // Remove all fetched nodes from loading state
                 setLoadingChildren(prev => {
                     const next = new Set(prev);
                     nodesToFetch.forEach(id => next.delete(id));
                     return next;
                 });
             }
         }
      },
      collapseNode: (nodeId: string, recursive: boolean = false): void => {
          setError(null);
          let nodesToClose = new Set<string>([nodeId]); // Start with the node itself

          if (recursive) {
              // Use the memoized nodeMap
              const descendants = findAllDescendantIds(treeData, nodeId, nodeMap);
              descendants.forEach(id => nodesToClose.add(id));
          }

          // Update open state
          setOpenNodes(prevOpenNodes => {
              const newOpenNodes = new Set(prevOpenNodes);
              let changed = false;
              // Remove all targeted nodes from the open set
              nodesToClose.forEach(id => { if(newOpenNodes.delete(id)) changed = true; });
              // Return new set only if changes occurred
              return changed ? newOpenNodes : prevOpenNodes;
          });
      },
      selectNode: (nodeId: string | null): void => {
          setError(null);
          setSelectedNodeId(nodeId); // Update internal state
          // Call external callback
          if (onNodeSelect) {
               if (nodeId) {
                  const { nodeData } = findNodeAndPath(treeData, nodeId);
                  // Prepare simplified data for callback
                  const callbackData = nodeData ? {
                      id: nodeData.id, name: nodeData.name, hasChildren: nodeData.hasChildren,
                      children: null, type: nodeData.type, icon: nodeData.icon,
                      ...Object.fromEntries(Object.entries(nodeData).filter(([key]) => !['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key)))
                  } : null;
                  onNodeSelect(nodeId, callbackData);
              } else {
                  onNodeSelect(null, null); // Notify deselection
              }
          }
      },
      // --- Checkbox Methods ---
      getCheckedNodes: (): string[] => {
          // Return array copy of the Set
          return Array.from(checkedNodes);
      },
      setCheckedNodes: (nodeIds: string[]): void => {
          // Replace internal state with the provided IDs
          const newCheckedSet = new Set(nodeIds);
          setCheckedNodes(newCheckedSet);
          // Notify external listener
          if (onCheckedNodesChange) {
              onCheckedNodesChange(newCheckedSet);
          }
      }
  }), [
      // --- List ALL state and props used within the imperative methods ---
      treeData, nodeMap, checkedNodes, selectedNodeId, openNodes, loadingChildren, nodeToMove, // State
      handleError, fetchChildrenForNodeProp, onNodeSelect, onCheckedNodesChange, // Callbacks/Props used
      // Include handlers if they are called directly by API methods (less common)
      // e.g. handleCheckboxChange, handleCompleteMove, handleCancelMove, toggleNode, handleSelectNode
  ]);


  // --- Render Logic ---
  return (
    // Wrapper for controls and tree container
    <div className={`virtualized-tree-view-wrapper ${containerClassName || ''}`} style={containerStyle}>

        {/* Optional Controls Area */}
        {!hideDefaultControls && (
            <div className="tree-controls">
                <button onClick={handleStartMove} disabled={!selectedNodeId || !!nodeToMove}>
                    {nodeToMove ? `Moving: ${nodeToMove.name}` : 'Move'}
                </button>
                {nodeToMove && ( <button onClick={handleCancelMove}> Cancel Move </button> )}
                {/* Example Internal Add Button */}
                <button onClick={handleAddNodeInternal} disabled={!!nodeToMove} style={{ marginLeft: 'auto' }}> Add Example </button>
                {nodeToMove && ( <div className="move-instruction">Click target parent node to complete move...</div> )}
            </div>
        )}

        {/* Tree View Area */}
        {isLoadingInitial ? (
            <div className="status-message">Loading...</div>
        ) : error && !treeData ? ( // Show error if initial load failed
            <div className="status-message error">Error loading tree: {error}</div>
        ) : !treeData || treeData.length === 0 ? ( // Handle empty state
            <div className="status-message">No tree data.</div>
        ) : (
            // Main scrollable container
            <div
                className="tree-view-container"
                ref={parentRef} // Ref for the virtualizer's scroll element
                tabIndex={0} // Make container focusable for keyboard navigation
                onKeyDown={handleKeyDown} // Attach keyboard handler
                aria-label="File Tree" // Accessibility label
            >
                {/* Inner container sized by the virtualizer */}
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`, // Total height of all items
                        width: 'fit-content', // Allow content to determine width
                        minWidth:'100%', // Ensure it fills container horizontally
                        position: 'relative' // For absolute positioning of virtual items
                    }}
                    role="tree" // ARIA role
                >
                    {/* Map over virtual items provided by the virtualizer */}
                    {rowVirtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                        const nodeIndex = virtualItem.index; // Index in the flatNodes array
                        const node = flatNodes[nodeIndex]; // Get the corresponding flat node data
                        if (!node) return null; // Should not happen, but safety check

                        // Style for positioning the virtual item absolutely
                        const nodeStyle: CSSProperties = {
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualItem.size}px`, // Height calculated by virtualizer
                            transform: `translateY(${virtualItem.start}px)`, // Vertical position
                        };

                        // Determine move state for UI feedback
                        const isMoveTargetCandidate = !!nodeToMove && node.id !== nodeToMove.id;
                        // Determine checked state
                        const isChecked = checkedNodes.has(node.id);
                        // Determine indeterminate state (only if checkboxes shown, node has children, and is not fully checked)
                        let isIndeterminate = false;
                        if (showCheckboxes && node.hasChildren && !isChecked) {
                            const hierarchicalNode = nodeMap.get(node.id); // Use map for direct access
                            if (hierarchicalNode && Array.isArray(hierarchicalNode.children)) {
                                 const loadedChildren = hierarchicalNode.children.filter(Boolean);
                                 if (loadedChildren.length > 0) {
                                     // Check if any loaded child is checked
                                     const checkedChildrenCount = loadedChildren.filter(child => checkedNodes.has(child.id)).length;
                                     isIndeterminate = checkedChildrenCount > 0;
                                 }
                            }
                         }

                        // Render the individual tree node using the dedicated component
                        return (
                            <TreeNodeComponent
                                key={node.id} // Use node ID as key
                                node={node}
                                style={nodeStyle}
                                selectedNodeId={selectedNodeId}
                                nodeIndex={nodeIndex}
                                isMoveTargetCandidate={isMoveTargetCandidate}
                                onToggle={toggleNode}
                                onSelect={handleSelectNode}
                                // --- Pass checkbox related props ---
                                showCheckboxes={showCheckboxes}
                                isChecked={isChecked}
                                isIndeterminate={isIndeterminate}
                                onCheckboxChange={handleCheckboxChange}
                            />
                        );
                    })}
                </div>
                {/* Display runtime errors overlayed */}
                {error && <div className="status-message error overlay-error">Error: {error}</div>}
            </div>
        )}
    </div>
  );
});
// Add display name for React DevTools
VirtualizedTreeView.displayName = 'VirtualizedTreeView';

// Export the reusable component
export default VirtualizedTreeView;