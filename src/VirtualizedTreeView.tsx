import React, { useState, useMemo, useRef, useCallback, useEffect, CSSProperties, KeyboardEvent, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer, VirtualItem } from '@tanstack/react-virtual';
import './TreeView.css'; // Consumers need to import or provide this CSS

// --- Type Definitions ---
// Raw data structure from API
export interface TreeNodeData {
  id: string;
  name: string;
  hasChildren: boolean;
  children: TreeNodeData[] | null;
  type?: 'folder' | 'file' | string; // Example types, can be extended
  icon?: string; // Example: emoji, class name, or URL
  // Allow arbitrary extra data
  [key: string]: any;
}

// TreeNode Class
class TreeNode implements TreeNodeData {
    id: string;
    name: string;
    hasChildren: boolean;
    children: TreeNode[] | null; // Children are also TreeNode instances
    type?: string;
    icon?: string;
    // Allow arbitrary extra data on the instance
    [key: string]: any;

    constructor(data: TreeNodeData) {
        this.id = data.id;
        this.name = data.name;
        this.hasChildren = data.hasChildren;
        this.children = Array.isArray(data.children)
            ? data.children.map(childData => new TreeNode(childData))
            : null;
        this.type = data.type;
        this.icon = data.icon;

        // Copy other potential properties from data
        for (const key in data) {
            if (!['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key)) {
                 this[key] = data[key];
            }
        }
    }

    get isFolder(): boolean { return this.type === 'folder'; }

    withChildren(newChildren: TreeNode[] | null): TreeNode {
        const updatedNode = this.clone(); // Use clone to copy all properties
        updatedNode.children = newChildren;
        updatedNode.hasChildren = Array.isArray(newChildren) && newChildren.length > 0;
        return updatedNode;
    }

     clone(overrides: Partial<TreeNodeData> = {}): TreeNode {
         // Create raw data from current instance, applying overrides
        const currentData = { ...this };
        // Need to handle children separately if they exist in overrides
        delete currentData.children; // Avoid spreading the children array of instances

        const rawData: TreeNodeData = {
            ...currentData, // Spread existing properties (id, name, type, icon, etc.)
            children: null, // Will be handled below
            ...overrides, // Apply overrides
        };

        const clonedNode = new TreeNode(rawData); // Creates new instance with basic props + overrides

        // Handle children based on overrides or original state
        if (overrides.children === null) {
            clonedNode.children = null;
            clonedNode.hasChildren = overrides.hasChildren ?? false;
        } else if (Array.isArray(overrides.children)) {
            // If children were provided in overrides (as raw data), constructor handles conversion
             clonedNode.children = overrides.children.map(cd => new TreeNode(cd));
             clonedNode.hasChildren = clonedNode.children.length > 0;
        } else if (!overrides.children && Array.isArray(this.children)) {
             // If children weren't overridden, shallow copy the existing children array of instances
             clonedNode.children = [...this.children];
             clonedNode.hasChildren = clonedNode.children.length > 0;
        } else {
             // Default case: no children override, no original children array
             clonedNode.children = null;
             clonedNode.hasChildren = overrides.hasChildren ?? this.hasChildren;
        }

        return clonedNode;
    }
}

// Flat node structure for rendering
interface FlatTreeNode {
  id: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  originalHasChildren: boolean;
  isLoaded: boolean;
  isLoadingChildren: boolean;
  isOpen: boolean;
  type?: string;
  icon?: string;
}

// Props for the TreeNodeComponent
interface TreeNodeComponentProps {
  node: FlatTreeNode;
  style: CSSProperties;
  selectedNodeId: string | null;
  nodeIndex: number;
  isMoveTargetCandidate: boolean;
  onToggle: (node: FlatTreeNode) => void;
  onSelect: (nodeId: string, nodeIndex: number) => void;
}

// --- Imperative API Handle Definition ---
export interface TreeViewHandle {
    addNode: (newNodeData: TreeNodeData, parentId?: string | null) => boolean; // Returns true on success
    removeNode: (nodeId: string) => boolean; // Returns true on success
    updateNode: (nodeId: string, updatedData: Partial<TreeNodeData>) => boolean; // Returns true on success
    getNodeHierarchy: (nodeId: string) => string[] | null; // Returns array of ancestor IDs or null
    expandNode: (nodeId: string, recursive?: boolean) => Promise<void>; // Expands a node, optionally recursively
    collapseNode: (nodeId: string, recursive?: boolean) => void; // Collapses a node, optionally recursively
    selectNode: (nodeId: string | null) => void; // Programmatically select a node
}


// --- Helper Functions (internal) ---
// Finds a node by ID and updates its children (used after fetching children)
const updateNodeInChildren = (
    nodes: TreeNode[] | null,
    nodeId: string,
    newChildrenData: TreeNodeData[]
): TreeNode[] | null => {
  if (!Array.isArray(nodes)) return nodes;

  let changed = false;
  const newNodes = nodes.map((node): TreeNode => {
    if (!node) return node;
    if (node.id === nodeId) {
      const newChildren = newChildrenData.map(childData => new TreeNode(childData));
      changed = true;
      return node.withChildren(newChildren);
    } else if (node.children && node.children.length > 0) {
      const updatedChildrenInstances = updateNodeInChildren(node.children, nodeId, newChildrenData);
      if (updatedChildrenInstances !== node.children) {
        changed = true;
        return node.withChildren(updatedChildrenInstances);
      }
    }
    return node;
  });
  return changed ? newNodes : nodes;
};

// Converts hierarchical data to a flat list for the virtualizer
const flattenTree = (
    nodes: TreeNode[] | null,
    openNodes: Set<string>,
    depth = 0,
    loadingChildren: Set<string>
): FlatTreeNode[] => {
  let flatList: FlatTreeNode[] = [];
  if (!Array.isArray(nodes)) return flatList;
  nodes.forEach((node: TreeNode | null) => {
    if (!node) return;
    const isOpen = openNodes.has(node.id);
    const isLoading = loadingChildren.has(node.id);
    const isLoaded = node.children !== null;
    const effectiveHasChildren = node.hasChildren || (isLoaded && Array.isArray(node.children) && node.children.length > 0);
    const flatNode: FlatTreeNode = {
      id: node.id, name: node.name, depth: depth, hasChildren: effectiveHasChildren,
      originalHasChildren: node.hasChildren, isLoaded: isLoaded, isLoadingChildren: isLoading,
      isOpen: isOpen, type: node.type, icon: node.icon,
    };
    flatList.push(flatNode);
    if (isOpen && isLoaded && Array.isArray(node.children) && node.children.length > 0) {
      flatList = flatList.concat(flattenTree(node.children, openNodes, depth + 1, loadingChildren));
    }
  });
  return flatList;
};

// Immutably adds a new node under the parent specified by the path array
const addNodeAtPath = (
    nodes: TreeNode[] | null,
    path: string[],
    newNodeInput: Partial<TreeNodeData> & { id: string; name: string }
): TreeNode[] | null => {
    if (!Array.isArray(nodes)) return nodes;
    const newNodeInstance = new TreeNode({ hasChildren: false, children: [], type: 'file', icon: '📄', ...newNodeInput, });
    if (path.length === 0) { return [...nodes, newNodeInstance]; }
    let changed = false;
    const updateRecursively = ( currentNodes: TreeNode[] | null, currentPath: string[] ): TreeNode[] | null => {
        if (!Array.isArray(currentNodes)) return currentNodes;
        const parentId = currentPath[0];
        const remainingPath = currentPath.slice(1);
        let listChanged = false;
        const mappedNodes = currentNodes.map(node => {
            if (!node) return node;
            if (node.id === parentId) {
                if (remainingPath.length === 0) {
                    if (Array.isArray(node.children)) {
                        const newChildren = [...node.children, newNodeInstance];
                        listChanged = true; changed = true;
                        return node.withChildren(newChildren);
                    } else { console.warn(`Cannot add node. Parent ${node.id} children not loaded.`); return node; }
                } else {
                    const updatedChildren = updateRecursively(node.children, remainingPath);
                    if (updatedChildren !== node.children) { listChanged = true; changed = true; return node.withChildren(updatedChildren); }
                }
            }
            return node;
        });
        return listChanged ? mappedNodes : currentNodes;
    };
    const finalTree = updateRecursively(nodes, path);
    return changed ? finalTree : nodes;
};

// Returns the modified tree AND the removed node data (or null if not found)
const findAndRemoveNode = (
    nodes: TreeNode[] | null,
    nodeIdToRemove: string
): { updatedTree: TreeNode[] | null, removedNode: TreeNode | null } => {
    if (!Array.isArray(nodes)) return { updatedTree: nodes, removedNode: null };
    let removedNode: TreeNode | null = null;
    let treeChanged = false;
    const processNodeList = (nodeList: TreeNode[]): TreeNode[] => {
        const nodeIndex = nodeList.findIndex(node => node?.id === nodeIdToRemove);
        if (nodeIndex !== -1) {
            removedNode = nodeList[nodeIndex];
            const updatedList = [...nodeList]; updatedList.splice(nodeIndex, 1);
            treeChanged = true; return updatedList;
        }
        let listChangedInRecursion = false;
        const mappedList = nodeList.map(node => {
            if (!node || removedNode) return node;
            if (Array.isArray(node.children)) {
                const originalChildren = node.children;
                const updatedChildren = processNodeList(originalChildren);
                if (updatedChildren !== originalChildren) {
                    listChangedInRecursion = true;
                    return node.withChildren(updatedChildren);
                }
            }
            return node;
        });
        if (listChangedInRecursion) { treeChanged = true; return mappedList; }
        return nodeList;
    };
    const finalTree = processNodeList(nodes);
    return { updatedTree: treeChanged ? finalTree : nodes, removedNode };
};

// Finds a node by ID and returns its data and the path (array of ancestor IDs)
const findNodeAndPath = (
    nodes: TreeNode[] | null,
    nodeId: string,
    currentPath: string[] = []
): { nodeData: TreeNode | null, path: string[] | null } => {
    if (!Array.isArray(nodes)) return { nodeData: null, path: null };
    for (const node of nodes) {
        if (!node) continue;
        if (node.id === nodeId) { return { nodeData: node, path: currentPath }; }
        if (Array.isArray(node.children)) {
            const result = findNodeAndPath(node.children, nodeId, [...currentPath, node.id]);
            if (result.nodeData) { return result; }
        }
    }
    return { nodeData: null, path: null };
};

// Helper function to update node data immutably
const updateNodeData = (
    nodes: TreeNode[] | null,
    nodeId: string,
    updatedData: Partial<TreeNodeData>
): { updatedTree: TreeNode[] | null, success: boolean } => {
    if (!Array.isArray(nodes)) return { updatedTree: nodes, success: false };
    let changed = false;
    const processList = (nodeList: TreeNode[]): TreeNode[] => {
        let listChanged = false;
        const mappedList = nodeList.map(node => {
            if (!node) return node;
            if (node.id === nodeId) {
                changed = true; listChanged = true;
                const { id, ...restOfUpdates } = updatedData; // Ensure ID isn't changed
                return node.clone(restOfUpdates); // Use clone helper
            }
            if (Array.isArray(node.children)) {
                const originalChildren = node.children;
                const updatedChildren = processList(originalChildren);
                if (updatedChildren !== originalChildren) {
                    listChanged = true;
                    return node.withChildren(updatedChildren);
                }
            }
            return node;
        });
        return listChanged ? mappedList : nodeList;
    };
    const finalTree = processList(nodes);
    return { updatedTree: changed ? finalTree : nodes, success: changed };
};

// Helper function to find all descendant IDs
const findAllDescendantIds = (
    nodes: TreeNode[] | null, // This expects the hierarchical TreeNode structure
    parentId: string,
    allNodesMap: Map<string, TreeNode> // Pre-built map for efficiency
): string[] => {
    const parentNode = allNodesMap.get(parentId);
    if (!parentNode || !Array.isArray(parentNode.children)) { return []; }

    let descendantIds: string[] = [];
    const queue: TreeNode[] = [...parentNode.children]; // Start with direct children instances

    while (queue.length > 0) {
        const current = queue.shift();
        if (current) {
            descendantIds.push(current.id);
            // Use the map to get the full child node if needed for further checks,
            // but for finding IDs, just traversing the structure is enough if children are instances.
            const fullCurrentNode = allNodesMap.get(current.id);
            if (fullCurrentNode && Array.isArray(fullCurrentNode.children)) {
                queue.push(...fullCurrentNode.children); // Add grandchildren instances to queue
            }
        }
    }
    return descendantIds;
};


// Helper function to build a map of all nodes for quick lookup
const buildNodeMap = (nodes: TreeNode[] | null): Map<string, TreeNode> => {
    const map = new Map<string, TreeNode>();
    const traverse = (nodeList: TreeNode[] | null) => {
        if (!Array.isArray(nodeList)) return;
        for (const node of nodeList) {
            if (node) {
                map.set(node.id, node);
                traverse(node.children);
            }
        }
    };
    traverse(nodes);
    return map;
};


// --- TreeNodeComponent (Internal Rendering Component) ---
const TreeNodeComponent: React.FC<TreeNodeComponentProps> = React.memo(({
    node, style, selectedNodeId, nodeIndex, isMoveTargetCandidate, onToggle, onSelect
}) => {
    const isSelected = node.id === selectedNodeId;
    const handleToggleClick = (e: React.MouseEvent<HTMLSpanElement>) => { e.stopPropagation(); onToggle(node); };
    const handleContentClick = () => { onSelect(node.id, nodeIndex); };

    return (
        <div role="treeitem" aria-selected={isSelected} aria-expanded={node.hasChildren ? node.isOpen : undefined}
            className={`tree-node ${isSelected ? 'selected' : ''} ${isMoveTargetCandidate ? 'move-target-candidate' : ''}`}
            style={style} // Apply virtualizer positioning style here
            onClick={handleContentClick} id={`tree-node-${node.id}`} >
            <div className="node-content">
                <div className="indent-lines">
                    {Array.from({ length: node.depth }).map((_, i) => ( <span key={i} className="indent-line"></span> ))}
                </div>
                {node.hasChildren ? (
                    <span className={`toggle ${node.isOpen ? 'open' : 'closed'}`} onClick={handleToggleClick}>
                        {node.isLoadingChildren ? <span className="spinner"></span> : (node.isOpen ? '▼' : '▶')}
                    </span>
                ) : ( <span className="toggle placeholder"></span> )}
                {node.icon && <span className="node-icon">{node.icon}</span>}
                <span className="node-name">{node.name}</span>
            </div>
        </div>
    );
});
TreeNodeComponent.displayName = 'TreeNodeComponent';


// --- Props for the main VirtualizedTreeView component ---
export interface VirtualizedTreeViewProps {
    fetchTopLevelNodes: () => Promise<TreeNodeData[]>;
    fetchChildrenForNode: (parentId: string) => Promise<TreeNodeData[]>;
    onNodeSelect?: (nodeId: string | null, nodeData: TreeNodeData | null) => void;
    onError?: (error: Error | string) => void;
    initialSelectedNodeId?: string | null;
    containerStyle?: CSSProperties;
    containerClassName?: string;
    hideDefaultControls?: boolean;
}

// --- Mock API Functions (Example - Can be replaced by props) ---
const exampleFetchTopLevelNodes = (): Promise<TreeNodeData[]> => {
  console.log("API: Fetching top-level nodes...");
  return new Promise((resolve) => {
    setTimeout(() => {
      const mockData: TreeNodeData[] = [
        { id: 'node-A', name: 'Node A (Folder)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
        { id: 'node-B', name: 'Node B (File)', hasChildren: false, children: [], type: 'file', icon: '📄' },
        { id: 'node-C', name: 'Node C (Folder)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
        ...Array.from({ length: 300 }, (_, i): TreeNodeData => { // Increased sample size
            const hasChildren = Math.random() > 0.5;
            return { id: `node-Top-${i}`, name: `Top Level ${hasChildren ? 'Folder' : 'Item'} ${i + 1}`, hasChildren: hasChildren, children: null, type: hasChildren ? 'folder' : 'file', icon: hasChildren ? '📁' : '📄' }
        })
      ];
       console.log("API: Fetched top-level nodes.");
      resolve(mockData);
    }, 1000);
  });
};
const exampleFetchChildrenForNode = (parentId: string): Promise<TreeNodeData[]> => {
 console.log(`API: Fetching children for node ${parentId}...`);
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      let children: TreeNodeData[] = [];
      if (parentId === 'node-A') { children = [ { id: 'node-A-1', name: 'Node A.1 (File)', hasChildren: false, children: [], type: 'file', icon: '📄' }, { id: 'node-A-2', name: 'Node A.2 (Folder) - Also has a long name to test scrolling', hasChildren: true, children: null, type: 'folder', icon: '📁' }, ]; }
      else if (parentId === 'node-C') { children = [ { id: 'node-C-1', name: 'Node C.1 (File)', hasChildren: false, children: [], type: 'file', icon: '📄' }, ]; }
      else if (parentId === 'node-A-2') { children = [ { id: 'node-A-2-1', name: 'Node A.2.1 (File) - Deeply nested and also quite long', hasChildren: false, children: [], type: 'file', icon: '📄' }, ]; }
      else if (parentId.startsWith('node-Top-')) {
         const parentIndex = parseInt(parentId.split('-')[2], 10);
         if (parentIndex % 3 === 0) { children = Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i): TreeNodeData => { const hasSubChildren = Math.random() > 0.8; return { id: `${parentId}-${i}`, name: `Sub ${hasSubChildren ? 'Folder' : 'File'} ${parentIndex + 1}.${i + 1} with extra text`, hasChildren: hasSubChildren, children: null, type: hasSubChildren ? 'folder' : 'file', icon: hasSubChildren ? '📁' : '📄', }; }); }
         else { children = []; }
      } else { children = []; }
       console.log(`API: Fetched ${children.length} children for node ${parentId}.`);
      resolve(children);
    }, 800);
  });
};

// --- VirtualizedTreeView Component (Exported) ---
const VirtualizedTreeView = forwardRef<TreeViewHandle, VirtualizedTreeViewProps>(({
    fetchTopLevelNodes: fetchTopLevelNodesProp = exampleFetchTopLevelNodes, // Default to example if not provided
    fetchChildrenForNode: fetchChildrenForNodeProp = exampleFetchChildrenForNode, // Default to example
    onNodeSelect,
    onError: onErrorCallback,
    initialSelectedNodeId = null,
    containerStyle,
    containerClassName,
    hideDefaultControls = false
}, ref) => {
  // State holds TreeNode instances
  const [treeData, setTreeData] = useState<TreeNode[] | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set());
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialSelectedNodeId);
  const [nodeToMove, setNodeToMove] = useState<TreeNode | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  // --- Error Handling ---
  const handleError = useCallback((err: any, context: string) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error ${context}:`, err);
      setError(errorMessage);
      if (onErrorCallback) { onErrorCallback(err instanceof Error ? err : errorMessage); }
  }, [onErrorCallback]);


  // --- Fetch Initial Data ---
  useEffect(() => {
    if (treeData === null) { // Only fetch if data isn't loaded
        setIsLoadingInitial(true); setError(null);
        fetchTopLevelNodesProp()
            .then((data: TreeNodeData[]) => {
                const initialTreeNodes = data.map(nodeData => new TreeNode(nodeData));
                setTreeData(initialTreeNodes);
                setOpenNodes(new Set());
                if (initialSelectedNodeId === null && initialTreeNodes.length > 0) {
                    setSelectedNodeId(initialTreeNodes[0].id);
                } else { setSelectedNodeId(initialSelectedNodeId); }
            })
            .catch((err) => handleError(err, 'fetching initial nodes'))
            .finally(() => { setIsLoadingInitial(false); });
    }
  }, [fetchTopLevelNodesProp, handleError, treeData, initialSelectedNodeId]);


  // --- Toggle Node Expansion & Fetch Children ---
  const toggleNode = useCallback(async (flatNode: FlatTreeNode) => {
    const { id, isOpen, originalHasChildren, isLoaded } = flatNode;
    const newOpenNodes = new Set(openNodes);
    if (isOpen) { newOpenNodes.delete(id); setOpenNodes(newOpenNodes); }
    else {
      newOpenNodes.add(id); setOpenNodes(newOpenNodes);
      if (originalHasChildren && !isLoaded && !loadingChildren.has(id)) {
        setLoadingChildren(prev => new Set(prev).add(id)); setError(null);
        try {
          const childrenData: TreeNodeData[] = await fetchChildrenForNodeProp(id);
          setTreeData((currentTreeData): TreeNode[] | null =>
              updateNodeInChildren(currentTreeData, id, childrenData)
          );
        } catch (err: any) {
          handleError(err, `fetching children for ${id}`);
          newOpenNodes.delete(id); setOpenNodes(new Set(newOpenNodes));
        } finally { setLoadingChildren(prev => { const next = new Set(prev); next.delete(id); return next; }); }
      }
    }
  }, [openNodes, loadingChildren, fetchChildrenForNodeProp, handleError]);

  // --- Handler to initiate moving a node ---
  const handleStartMove = useCallback(() => {
      if (!selectedNodeId) return; setError(null);
      const { nodeData } = findNodeAndPath(treeData, selectedNodeId);
      if (nodeData) { setNodeToMove(nodeData); setSelectedNodeId(null); console.log(`Ready to move node: ${nodeData.name} (${nodeData.id})`); }
      else { console.error("Could not find selected node data to move."); setError("Could not find selected node data."); handleError(new Error("Could not find selected node data."), "starting move"); }
  }, [selectedNodeId, treeData, handleError]);

  // --- Handler to cancel moving ---
  const handleCancelMove = useCallback(() => { setNodeToMove(null); setError(null); console.log("Move cancelled."); }, []);

  // --- Handler to complete the move ---
  const handleCompleteMove = useCallback((targetParentId: string | null) => {
      if (!nodeToMove) return; setError(null);
      if (nodeToMove.id === targetParentId) { setError("Cannot move a node into itself."); setNodeToMove(null); return; }
      const { nodeData: targetParentData, path: targetPathArray } = targetParentId ? findNodeAndPath(treeData, targetParentId) : { nodeData: null, path: [] };
      if (targetPathArray && targetPathArray.includes(nodeToMove.id)) { setError("Cannot move a node into its own descendant."); setNodeToMove(null); return; }
      if (targetParentData && targetParentData.children === null) { setError(`Target parent "${targetParentData.name}" must be expanded first.`); return; }
      console.log(`Attempting to move ${nodeToMove.id} to parent ${targetParentId || 'root'}`);
      const { updatedTree: treeAfterRemove, removedNode } = findAndRemoveNode(treeData, nodeToMove.id);
      if (!removedNode) { setError("Failed to remove the original node."); setNodeToMove(null); return; }
      const finalTree = addNodeAtPath( treeAfterRemove, targetPathArray || [], removedNode );
      setTreeData(finalTree); setNodeToMove(null); setSelectedNodeId(nodeToMove.id);
      console.log(`Successfully moved ${nodeToMove.id} to parent ${targetParentId || 'root'}`);
  }, [nodeToMove, treeData, handleError]);

  // --- Select Node (or Complete Move) & Call External Callback ---
  const handleSelectNode = useCallback((nodeId: string, nodeIndex: number) => {
      setError(null);
      if (nodeToMove) { handleCompleteMove(nodeId); }
      else {
          const newSelectedId = selectedNodeId === nodeId ? null : nodeId;
          setSelectedNodeId(newSelectedId);
          if (onNodeSelect) {
              if (newSelectedId) {
                  const { nodeData } = findNodeAndPath(treeData, newSelectedId);
                  onNodeSelect(newSelectedId, nodeData ? { id: nodeData.id, name: nodeData.name, hasChildren: nodeData.hasChildren, children: null, type: nodeData.type, icon: nodeData.icon, ...Object.fromEntries(Object.entries(nodeData).filter(([key]) => !['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key))) } : null);
              } else { onNodeSelect(null, null); }
          }
      }
  }, [nodeToMove, handleCompleteMove, selectedNodeId, onNodeSelect, treeData]);

  // --- Add Node Handler (Example for internal button) ---
  const handleAddNodeInternal = () => {
      const newNodeInput: Partial<TreeNodeData> & { id: string; name: string } = { id: `new-node-${Date.now()}`, name: 'Dynamically Added File', };
      const targetPath = ['node-A'];
      setTreeData(currentTreeData => addNodeAtPath(currentTreeData, targetPath, newNodeInput));
  };

  // --- Flatten Nodes (Memoized) ---
  const flatNodes: FlatTreeNode[] = useMemo(() => {
     return flattenTree(treeData, openNodes, 0, loadingChildren);
  }, [treeData, openNodes, loadingChildren]);

  // --- Virtualizer Setup ---
  const rowVirtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: flatNodes.length, getScrollElement: () => parentRef.current, estimateSize: () => 35,
    overscan: 5, scrollPaddingStart: 10, scrollPaddingEnd: 10,
   });

  // --- Scroll To Selected Node ---
  useEffect(() => {
      if (selectedNodeId !== null && rowVirtualizer && rowVirtualizer.scrollToIndex) {
          const selectedIndex = flatNodes.findIndex(node => node.id === selectedNodeId);
          if (selectedIndex !== -1) {
              rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto', behavior: 'auto' });
          }
      }
  }, [selectedNodeId, flatNodes, rowVirtualizer]);


  // --- Keyboard Navigation ---
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (flatNodes.length === 0) return;
      const currentSelectedIndex = selectedNodeId !== null ? flatNodes.findIndex(node => node.id === selectedNodeId) : -1;
      let nextSelectIndex: number = currentSelectedIndex;
      if (currentSelectedIndex === -1 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          nextSelectIndex = event.key === 'ArrowDown' ? 0 : flatNodes.length - 1;
          if (nextSelectIndex >= 0 && nextSelectIndex < flatNodes.length) { handleSelectNode(flatNodes[nextSelectIndex].id, nextSelectIndex); }
          return;
      }
      if (currentSelectedIndex === -1) return;
      const currentNode = flatNodes[currentSelectedIndex];
      if (!currentNode) return;
      if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (nodeToMove) { handleCompleteMove(currentNode.id); }
          else { handleSelectNode(currentNode.id, currentSelectedIndex); } // Toggle selection on Enter/Space
          return;
      }
      if (event.key === 'Escape' && nodeToMove) { event.preventDefault(); handleCancelMove(); return; }
      switch (event.key) {
          case 'ArrowDown': event.preventDefault(); nextSelectIndex = Math.min(currentSelectedIndex + 1, flatNodes.length - 1); break;
          case 'ArrowUp': event.preventDefault(); nextSelectIndex = Math.max(currentSelectedIndex - 1, 0); break;
          case 'ArrowRight':
              event.preventDefault();
              if (currentNode.hasChildren) {
                  if (!currentNode.isOpen) { toggleNode(currentNode); nextSelectIndex = currentSelectedIndex; }
                  else if (currentSelectedIndex + 1 < flatNodes.length && flatNodes[currentSelectedIndex + 1].depth > currentNode.depth) { nextSelectIndex = currentSelectedIndex + 1; }
              } break;
          case 'ArrowLeft':
              event.preventDefault();
              if (currentNode.isOpen && currentNode.hasChildren) { toggleNode(currentNode); nextSelectIndex = currentSelectedIndex; }
              else if (currentNode.depth > 0) {
                  let parentIndex = -1;
                  for (let i = currentSelectedIndex - 1; i >= 0; i--) { if (flatNodes[i].depth === currentNode.depth - 1) { parentIndex = i; break; } }
                  if (parentIndex !== -1) { nextSelectIndex = parentIndex; }
              } break;
          case 'Home': event.preventDefault(); nextSelectIndex = 0; break;
          case 'End': event.preventDefault(); nextSelectIndex = flatNodes.length - 1; break;
          default: return;
      }
      // Select the node when navigating with arrows
      if (nextSelectIndex !== -1 && nextSelectIndex !== currentSelectedIndex) {
          handleSelectNode(flatNodes[nextSelectIndex].id, nextSelectIndex);
      }
  }, [flatNodes, selectedNodeId, nodeToMove, toggleNode, handleSelectNode, handleCompleteMove, handleCancelMove]);

  // --- Imperative API Implementation ---
  useImperativeHandle(ref, (): TreeViewHandle => ({
      addNode: (newNodeData: TreeNodeData, parentId: string | null = null): boolean => {
          setError(null);
          let targetPath: string[] = [];
          if (parentId) {
              const { path } = findNodeAndPath(treeData, parentId);
              if (!path) { handleError(new Error(`Parent node with ID ${parentId} not found.`), 'adding node'); return false; }
              targetPath = [...path, parentId];
          }
          const { nodeData: parentNode } = parentId ? findNodeAndPath(treeData, parentId) : { nodeData: null };
          if (parentId && parentNode?.children === null) { handleError(new Error(`Parent node ${parentId} children not loaded. Expand first.`), 'adding node'); return false; }
          const success = setTreeData(currentTreeData => addNodeAtPath(currentTreeData, targetPath, newNodeData));
          return !!success;
      },
      removeNode: (nodeId: string): boolean => {
          setError(null);
          const { updatedTree, removedNode } = findAndRemoveNode(treeData, nodeId);
          if (removedNode) {
              setTreeData(updatedTree);
              if (selectedNodeId === nodeId) { setSelectedNodeId(null); if (onNodeSelect) onNodeSelect(null, null); }
              return true;
          } else { handleError(new Error(`Node with ID ${nodeId} not found for removal.`), 'removing node'); return false; }
      },
      updateNode: (nodeId: string, updatedData: Partial<TreeNodeData>): boolean => {
          setError(null);
          const { id, ...restOfUpdates } = updatedData; // Ensure ID is not changed
          const { updatedTree, success } = updateNodeData(treeData, nodeId, restOfUpdates);
          if (success) { setTreeData(updatedTree); return true; }
          else { handleError(new Error(`Node with ID ${nodeId} not found for update.`), 'updating node'); return false; }
      },
      getNodeHierarchy: (nodeId: string): string[] | null => {
          const { path } = findNodeAndPath(treeData, nodeId);
          return path ? [...path, nodeId] : null;
      },
      expandNode: async (nodeId: string, recursive: boolean = false): Promise<void> => {
         setError(null);
         const nodeMap = buildNodeMap(treeData);
         const nodeToExpand = nodeMap.get(nodeId);
         const nodesToOpen = new Set<string>([nodeId]);
         if (!nodeToExpand) { handleError(new Error(`Node ${nodeId} not found for expansion.`), 'expanding node'); return; }
         const queue: TreeNode[] = [nodeToExpand];
         let treeNeedsUpdate = false; // Track if setTreeData is needed

         while(queue.length > 0) {
             const current = queue.shift()!;
             if (current.hasChildren && current.children === null && !loadingChildren.has(current.id)) {
                  setLoadingChildren(prev => new Set(prev).add(current.id));
                  try {
                      const childrenData = await fetchChildrenForNodeProp(current.id);
                      // Update state directly - this is the tricky part with imperative handle
                      setTreeData(prevTreeData => {
                          const updated = updateNodeInChildren(prevTreeData, current.id, childrenData);
                          if (updated !== prevTreeData) treeNeedsUpdate = true;
                          return updated;
                      });
                      // Need to wait for state update or re-find node if recursive
                      // For simplicity, we won't handle recursive expansion *after* a fetch within this loop
                      // A more robust solution might involve triggering a re-flatten/re-render
                  } catch (err) { handleError(err, `fetching children for ${current.id} during expand`);
                  } finally { setLoadingChildren(prev => { const next = new Set(prev); next.delete(current.id); return next; }); }
             } else if (recursive && current.hasChildren && Array.isArray(current.children)) {
                 queue.push(...current.children);
                 current.children.forEach(child => nodesToOpen.add(child.id));
             }
         }
         setOpenNodes(prevOpenNodes => {
             const newOpenNodes = new Set(prevOpenNodes);
             nodesToOpen.forEach(id => newOpenNodes.add(id));
             // Only return new Set if changed
             return newOpenNodes.size !== prevOpenNodes.size || ![...nodesToOpen].every(id => prevOpenNodes.has(id)) ? newOpenNodes : prevOpenNodes;
         });
      },
      collapseNode: (nodeId: string, recursive: boolean = false): void => {
          setError(null);
          let nodesToClose = new Set<string>([nodeId]);
          if (recursive) {
              const nodeMap = buildNodeMap(treeData);
              const descendants = findAllDescendantIds(treeData, nodeId, nodeMap);
              descendants.forEach(id => nodesToClose.add(id));
          }
          setOpenNodes(prevOpenNodes => {
              const newOpenNodes = new Set(prevOpenNodes);
              let changed = false;
              nodesToClose.forEach(id => { if(newOpenNodes.delete(id)) changed = true; });
              return changed ? newOpenNodes : prevOpenNodes;
          });
      },
      selectNode: (nodeId: string | null): void => {
          setError(null);
          setSelectedNodeId(nodeId);
          if (onNodeSelect) {
               if (nodeId) {
                  const { nodeData } = findNodeAndPath(treeData, nodeId);
                  onNodeSelect(nodeId, nodeData ? { id: nodeData.id, name: nodeData.name, hasChildren: nodeData.hasChildren, children: null, type: nodeData.type, icon: nodeData.icon, ...Object.fromEntries(Object.entries(nodeData).filter(([key]) => !['id', 'name', 'hasChildren', 'children', 'type', 'icon'].includes(key))) } : null);
              } else { onNodeSelect(null, null); }
          }
      }
  }), [
      treeData, handleError, openNodes, loadingChildren, selectedNodeId, nodeToMove,
      fetchChildrenForNodeProp, onNodeSelect, handleCompleteMove, handleCancelMove, toggleNode,
  ]);

  // --- Render ---
  return (
    // Wrapper for controls and tree container
    <div className={`virtualized-tree-view-wrapper ${containerClassName || ''}`} style={containerStyle}>
        {/* Controls Area - Render conditionally based on prop */}
        {!hideDefaultControls && (
            <div className="tree-controls">
                <button onClick={handleStartMove} disabled={!selectedNodeId || !!nodeToMove}>
                    {nodeToMove ? `Moving: ${nodeToMove.name}` : 'Move'}
                </button>
                {nodeToMove && ( <button onClick={handleCancelMove}> Cancel </button> )}
                <button onClick={handleAddNodeInternal} disabled={!!nodeToMove} style={{ marginLeft: 'auto' }}> Add </button>
                {nodeToMove && ( <div className="move-instruction">Select new parent...</div> )}
            </div>
        )}

        {/* Tree View Container */}
        {isLoadingInitial ? ( <div className="status-message">Loading...</div> )
         : error && !treeData ? ( <div className="status-message error">Error: {error}</div> )
         : !treeData || treeData.length === 0 ? ( <div className="status-message">No tree data.</div> )
         : (
            <div className="tree-view-container" ref={parentRef}
                 tabIndex={0} // Make container focusable
                 onKeyDown={handleKeyDown} // Attach keyboard handler
                 aria-label="File Tree" >
                {/* Inner container for virtual items */}
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: 'fit-content', minWidth:'100%', position: 'relative' }} role="tree">
                    {rowVirtualizer.getVirtualItems().map((virtualItem: VirtualItem) => {
                        const nodeIndex = virtualItem.index;
                        const node = flatNodes[nodeIndex];
                        if (!node) return null;
                        const nodeStyle: CSSProperties = { position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualItem.size}px`, transform: `translateY(${virtualItem.start}px)`, };
                        const isMoveTargetCandidate = !!nodeToMove && node.id !== nodeToMove.id;

                        // Use TreeNodeComponent for rendering
                        return ( <TreeNodeComponent key={node.id} node={node} style={nodeStyle}
                            selectedNodeId={selectedNodeId} nodeIndex={nodeIndex}
                            isMoveTargetCandidate={isMoveTargetCandidate}
                            onToggle={toggleNode} onSelect={handleSelectNode} />
                        );
                    })}
                </div>
                {/* Display runtime errors */}
                {error && <div className="status-message error overlay-error">Error: {error}</div>}
            </div>
        )}
    </div>
  );
});
// Add display name for React DevTools
VirtualizedTreeView.displayName = 'VirtualizedTreeView';


// --- Helper implementations are included above ---

// Export the reusable component
export default VirtualizedTreeView;

// --- Example Usage (Commented Out) ---
/*

*/
