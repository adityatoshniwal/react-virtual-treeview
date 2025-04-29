import React, { useRef, useState, useCallback } from 'react';
// Adjust the import path based on where you saved the component
import VirtualizedTreeView, { TreeNodeData, TreeViewHandle } from './VirtualizedTreeView';
// Ensure you import the CSS as well
import './TreeView.css';

// --- Example API Functions (Replace with your actual API calls) ---
// These are needed for the VirtualizedTreeView component to function

const myFetchTopLevelNodes = async (): Promise<TreeNodeData[]> => {
    console.log("Example API: Fetching top-level nodes...");
    await new Promise(res => setTimeout(res, 500)); // Simulate delay
    return [
        { id: 'root-1', name: 'Root Folder 1', hasChildren: true, children: null, type: 'folder', icon: '📁' },
        { id: 'root-2', name: 'Root File 1', hasChildren: false, children: [], type: 'file', icon: '📄' },
        { id: 'root-3', name: 'Root Folder 2 (Empty)', hasChildren: true, children: [], type: 'folder', icon: '📁' }, // Example initially loaded empty folder
         ...Array.from({ length: 10 }, (_, i): TreeNodeData => { // Smaller sample for example clarity
            const hasChildren = Math.random() > 0.6;
            return { id: `ex-top-${i}`, name: `Example Top ${hasChildren ? 'Folder' : 'Item'} ${i + 1}`, hasChildren: hasChildren, children: null, type: hasChildren ? 'folder' : 'file', icon: hasChildren ? '📁' : '📄' }
        })
    ];
};

const myFetchChildrenForNode = async (parentId: string): Promise<TreeNodeData[]> => {
     console.log(`Example API: Fetching children for ${parentId}...`);
     await new Promise(res => setTimeout(res, 600)); // Simulate delay
     if (parentId === 'root-1') {
         return [
            { id: 'child-1-1', name: 'Child File 1.1', hasChildren: false, children: [], type: 'file', icon: '📄', customData: 'abc' },
            { id: 'child-1-2', name: 'Child Folder 1.2', hasChildren: true, children: null, type: 'folder', icon: '📁' },
         ];
     }
     if (parentId === 'child-1-2') {
         return [
            { id: 'sub-child-1', name: 'Sub Child File', hasChildren: false, children: [], type: 'file', icon: '📄' },
         ];
     }
      if (parentId.startsWith('ex-top-') && parentId.endsWith('-folder')) { // Example dynamic children
          return Array.from({ length: 2 }, (_, i) => ({
              id: `${parentId}-sub-${i}`,
              name: `Dynamic Sub ${i}`,
              hasChildren: false,
              children: [],
              type: 'file',
              icon: '📄'
          }));
      }
    return []; // Default empty
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
