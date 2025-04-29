import React, { useRef, useState, useCallback } from 'react';
// Adjust the import path based on where you saved the component
import VirtualizedTreeView, { TreeNodeData, TreeViewHandle } from './VirtualizedTreeView';
// Ensure you import the CSS as well
import './TreeView.css';

// --- Example API Functions (Replace with your actual API calls) ---
// These are needed for the VirtualizedTreeView component to function
const myFetchTopLevelNodes = async (): Promise<TreeNodeData[]> => {
  console.log("Example API (Expanded): Fetching top-level nodes...");
  await new Promise(res => setTimeout(res, 500)); // Simulate delay

  // Increased base nodes + significantly more dynamic nodes
  const baseNodes: TreeNodeData[] = [
      { id: 'root-1', name: 'Root Folder 1 (Deeper)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
      { id: 'root-2', name: 'Root File 1', hasChildren: false, children: [], type: 'file', icon: '📄' },
      { id: 'root-3', name: 'Root Folder 2 (Now with Children)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
      { id: 'root-4', name: 'Another Root Folder', hasChildren: true, children: null, type: 'folder', icon: '📁' },
  ];

  // --- Increased Sample Size: Generate 50 dynamic top-level nodes ---
  const dynamicNodes = Array.from({ length: 50 }, (_, i): TreeNodeData => {
      const id = `ex-top-${i}`;
      // Make roughly 40% folders to allow for depth expansion
      const hasChildren = Math.random() > 0.6;
      return {
          id: hasChildren ? `${id}-folder` : id, // Append -folder for easier dynamic handling
          name: `Example Top ${hasChildren ? 'Folder' : 'Item'} ${i + 1}`,
          hasChildren: hasChildren,
          children: hasChildren ? null : [],
          type: hasChildren ? 'folder' : 'file',
          icon: hasChildren ? '📁' : '📄'
      };
  });

  return [...baseNodes, ...dynamicNodes];
};


const myFetchChildrenForNode = async (parentId: string): Promise<TreeNodeData[]> => {
  console.log(`Example API (Expanded): Fetching children for ${parentId}...`);
  // Keep the simulated delay
  await new Promise(res => setTimeout(res, 800));

  // --- Handling for root-1 (Unchanged from previous expansion) ---
  if (parentId === 'root-1') {
      return [
         { id: 'child-1-1', name: 'Child File 1.1', hasChildren: false, children: [], type: 'file', icon: '📄', customData: 'abc' },
         { id: 'child-1-2-folder', name: 'Child Folder 1.2 (Deeper)', hasChildren: true, children: null, type: 'folder', icon: '📁' },
         { id: 'child-1-3', name: 'Child File 1.3', hasChildren: false, children: [], type: 'file', icon: '📄' },
         { id: 'child-1-4-folder', name: 'Child Folder 1.4', hasChildren: true, children: null, type: 'folder', icon: '📁' },
         { id: 'child-1-5', name: 'Child File 1.5', hasChildren: false, children: [], type: 'file', icon: '📄' },
         { id: 'child-1-6', name: 'Child File 1.6', hasChildren: false, children: [], type: 'file', icon: '📄' },
         { id: 'child-1-7-folder', name: 'Child Folder 1.7 (Empty)', hasChildren: true, children: [], type: 'folder', icon: '📁'},
         { id: 'child-1-8', name: 'Child File 1.8', hasChildren: false, children: [], type: 'file', icon: '📄' },
      ];
  }

  // --- Handling for child-1-2-folder (Unchanged from previous expansion) ---
  if (parentId === 'child-1-2-folder') {
      return [
         { id: 'sub-child-1-folder', name: 'Sub Child Folder 1 (Now with 100 children)', hasChildren: true, children: null, type: 'folder', icon: '📁' }, // Name updated for clarity
         { id: 'sub-child-2', name: 'Sub Child File 2', hasChildren: false, children: [], type: 'file', icon: '📄' },
         { id: 'sub-child-3', name: 'Sub Child File 3', hasChildren: false, children: [], type: 'file', icon: '📄' },
         { id: 'sub-child-4-folder', name: 'Sub Child Folder 4', hasChildren: true, children: null, type: 'folder', icon: '📁' },
         { id: 'sub-child-5', name: 'Sub Child File 5', hasChildren: false, children: [], type: 'file', icon: '📄' },
      ];
  }

  // --- MODIFIED: Handler for 'sub-child-1-folder' to return 100 children ---
  if (parentId === 'sub-child-1-folder') {
      console.log(`Generating 100 children for ${parentId}...`);
      // Generate 100 simple file nodes
      return Array.from({ length: 100 }, (_, i): TreeNodeData => {
          const childId = `sub-child-1-file-${i + 1}`; // Create unique IDs
          return {
              id: childId,
              name: `Very Many File ${i + 1}`, // Simple naming convention
              hasChildren: false,            // These are leaf nodes
              children: [],                  // No children for these nodes
              type: 'file',
              icon: '📄'                     // Standard file icon
          };
      });
  }

  // --- Handler for deepest static level (Unchanged, but now potentially unreachable via this path) ---
   // Note: grandchild-2-folder is no longer returned by sub-child-1-folder
   if (parentId === 'grandchild-2-folder') {
       return [
          { id: 'great-grandchild-1', name: 'Great Grandchild File 1', hasChildren: false, children: [], type: 'file', icon: '📄' },
       ];
   }

   // --- Other handlers (Unchanged from previous expansion) ---
   if (parentId === 'root-3') {
        return Array.from({ length: 3 }, (_, i) => ({
           id: `r3-child-${i}`, name: `R3 Child ${i}`, hasChildren: false, children: [], type: 'file', icon: '📄'
        }));
   }
   if (parentId === 'root-4') {
        return Array.from({ length: 6 }, (_, i) => ({
           id: `r4-child-${i}`, name: `R4 Child ${i}`, hasChildren: i % 3 === 0,
           children: i % 3 === 0 ? null : [], type: i % 3 === 0 ? 'folder' : 'file', icon: i % 3 === 0 ? '📁' : '📄'
        }));
   }
    if (parentId === 'child-1-4-folder') {
        return Array.from({ length: 2 }, (_, i) => ({
           id: `c1-4-child-${i}`, name: `C1-4 Child ${i}`, hasChildren: false, children: [], type: 'file', icon: '📄'
        }));
   }
     if (parentId === 'sub-child-4-folder') {
        return [ { id: 'sc4-child-1', name: `SC4 Child 1`, hasChildren: false, children: [], type: 'file', icon: '📄' }];
   }

   // --- DYNAMIC CHILDREN Logic (Unchanged from previous expansion) ---
   const dynamicMatch = parentId.match(/^(ex-top-\d+)(-folder(-sub-\d+)*)(-folder)$/);
   if (dynamicMatch) {
       const baseId = dynamicMatch[1];
       const pathPart = dynamicMatch[2];
       const currentLevel = (pathPart.match(/-sub-/g) || []).length;
       const maxDynamicDepth = 4;

       return Array.from({ length: 10 }, (_, i) => { // Still generates 10 dynamic children per dynamic folder
           const newIdBase = `${baseId}${pathPart}-sub-${i}`;
           const makeFolder = i % 4 === 0 && currentLevel < maxDynamicDepth;
           const node: TreeNodeData = {
               id: makeFolder ? `${newIdBase}-folder` : newIdBase,
               name: `Dynamic L${currentLevel + 1}-${i} ${makeFolder ? '(Folder)' : '(File)'}`,
               hasChildren: makeFolder,
               children: makeFolder ? null : [],
               type: makeFolder ? 'folder' : 'file',
               icon: makeFolder ? '📁' : '📄'
           };
           return node;
       });
   }

 // Default empty for any other unhandled ID
 return [];
};

// --- Example Parent Component ---

const TreeViewExampleApp = () => {
    // Ref to access the TreeView's imperative methods
    const treeRef = useRef<TreeViewHandle>(null);
    // State to keep track of the currently selected node's data in the parent
    const [selectedNode, setSelectedNode] = useState<TreeNodeData | null>(null);
    // State to display hierarchy results
    const [hierarchyResult, setHierarchyResult] = useState<string | null>(null);

    // Callback for when a node is selected within the tree view
    const handleNodeSelect = useCallback((nodeId: string | null, nodeData: TreeNodeData | null) => {
        console.log("App: Node Selected:", nodeId, nodeData);
        setSelectedNode(nodeData); // Update parent state
        setHierarchyResult(null); // Clear hierarchy on new selection
    }, []); // No dependencies needed if only setting state

     // Callback for handling errors from the tree view
     const handleError = useCallback((error: Error | string) => {
         console.error("App: Tree View Error:", error);
         // Display error to the user (e.g., using a toast notification library)
         alert(`Tree View Error: ${error instanceof Error ? error.message : error}`);
     }, []); // No dependencies needed

     // --- Functions to call the Imperative API ---

     const apiAddNode = () => {
         if (treeRef.current) {
             const parentId = selectedNode?.id ?? null; // Add under selected node, or root if none selected
             // Ensure parent is a folder type before adding? (Optional validation)
             // if (parentId && selectedNode?.type !== 'folder') {
             //    alert("Please select a folder to add a node under.");
             //    return;
             // }
             const success = treeRef.current.addNode({
                 id: `api-add-${Date.now()}`,
                 name: `API Added Node`,
                 type: 'file',
                 icon: '✨'
             }, parentId);
             if (success) console.log(`API: Added node under ${parentId || 'root'}`);
             else console.error("API: Failed to add node.");
         }
     };

      const apiRemoveSelectedNode = () => {
         if (treeRef.current && selectedNode) {
            const success = treeRef.current.removeNode(selectedNode.id);
             if (success) {
                 console.log(`API: Removed node ${selectedNode.id}`);
                 setSelectedNode(null); // Clear selection in parent state
             } else {
                 console.error(`API: Failed to remove node ${selectedNode.id}`);
             }
         }
     };

     const apiUpdateSelectedNode = () => {
         if (treeRef.current && selectedNode) {
             const success = treeRef.current.updateNode(selectedNode.id, {
                 name: selectedNode.name + " (Updated)",
                 icon: '✅' // Example: change icon
             });
              if (success) console.log(`API: Updated node ${selectedNode.id}`);
              else console.error(`API: Failed to update node ${selectedNode.id}`);
         }
     };

     const apiGetSelectedHierarchy = () => {
         if (treeRef.current && selectedNode) {
             const path = treeRef.current.getNodeHierarchy(selectedNode.id);
             console.log(`API: Hierarchy for ${selectedNode.name}:`, path);
             setHierarchyResult(path ? path.join(' -> ') : 'Hierarchy not found');
         } else {
             setHierarchyResult('No node selected.');
         }
     };

     const apiExpandSelected = (recursive: boolean = false) => {
         if (treeRef.current && selectedNode) {
             console.log(`API: Expanding node ${selectedNode.id} ${recursive ? '(Recursive)' : ''}`);
             treeRef.current.expandNode(selectedNode.id, recursive)
                .then(() => console.log(`API: Expansion complete for ${selectedNode.id}`))
                .catch(err => console.error("API: Expansion error", err)); // Handle potential async errors
         }
     };

     const apiCollapseSelected = (recursive: boolean = false) => {
          if (treeRef.current && selectedNode) {
             console.log(`API: Collapsing node ${selectedNode.id} ${recursive ? '(Recursive)' : ''}`);
             treeRef.current.collapseNode(selectedNode.id, recursive);
         }
     };

     const apiSelectRoot1 = () => {
         if (treeRef.current) {
             console.log("API: Selecting node 'root-1'");
             treeRef.current.selectNode('root-1');
         }
     };
     const apiDeselect = () => {
         if (treeRef.current) {
             console.log("API: Deselecting node");
             treeRef.current.selectNode(null);
         }
     };


    return (
        <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
            {/* Sidebar containing the TreeView */}
            <div style={{ width: '350px', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                 <h4 style={{padding: '10px 10px 0 10px', margin: 0}}>File Tree</h4>
                 <VirtualizedTreeView
                    ref={treeRef} // Assign the ref
                    fetchTopLevelNodes={myFetchTopLevelNodes}
                    fetchChildrenForNode={myFetchChildrenForNode}
                    onNodeSelect={handleNodeSelect}
                    onError={handleError}
                    containerStyle={{ flexGrow: 1 }} // Allow tree to grow vertically
                    hideDefaultControls={true} // Hide the built-in controls
                    showCheckboxes
                 />
            </div>

            {/* Main Content / API Control Area */}
            <div style={{ flexGrow: 1, padding: '20px', overflowY: 'auto' }}>
                 <h4>Tree View API Controls</h4>
                 <div style={{ marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid #eee' }}>
                     <strong>Selected Node:</strong> {selectedNode ? `${selectedNode.name} (${selectedNode.id})` : 'None'}
                 </div>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {/* Add Node */}
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={apiAddNode}>
                            Add Node under {selectedNode ? 'Selected' : 'Root'}
                        </button>
                        <span>(Adds a new file node)</span>
                    </div>

                    {/* Remove Node */}
                     <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={apiRemoveSelectedNode} disabled={!selectedNode}>
                            Remove Selected Node
                        </button>
                    </div>

                     {/* Update Node */}
                     <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={apiUpdateSelectedNode} disabled={!selectedNode}>
                            Update Selected Node
                        </button>
                         <span>(Appends "(Updated)" to name, changes icon)</span>
                    </div>

                     {/* Get Hierarchy */}
                     <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={apiGetSelectedHierarchy} disabled={!selectedNode}>
                            Get Selected Hierarchy
                        </button>
                        {hierarchyResult && <span style={{ marginLeft: '10px', fontStyle: 'italic', color: '#555' }}>Result: {hierarchyResult}</span>}
                    </div>

                     {/* Expand/Collapse */}
                     <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={() => apiExpandSelected(false)} disabled={!selectedNode || !selectedNode.hasChildren}>
                            Expand Selected
                        </button>
                         <button onClick={() => apiExpandSelected(true)} disabled={!selectedNode || !selectedNode.hasChildren}>
                            Expand Selected (Recursive)
                        </button>
                        <button onClick={() => apiCollapseSelected(false)} disabled={!selectedNode || !selectedNode.hasChildren}>
                            Collapse Selected
                        </button>
                         <button onClick={() => apiCollapseSelected(true)} disabled={!selectedNode || !selectedNode.hasChildren}>
                            Collapse Selected (Recursive)
                        </button>
                    </div>

                     {/* Select */}
                     <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button onClick={apiSelectRoot1}>
                            Select "Root Folder 1"
                        </button>
                         <button onClick={apiDeselect}>
                            Deselect All
                        </button>
                    </div>

                 </div>
             </div>
        </div>
    );
};

export default TreeViewExampleApp; // Export the example app
