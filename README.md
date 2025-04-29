# React Virtualized Tree View Component

A highly performant and feature-rich tree view component for React, built with TypeScript and leveraging `@tanstack/react-virtual` for virtualization.

## Features

* **Virtualization:** Handles thousands of nodes efficiently by rendering only visible items. Powered by `@tanstack/react-virtual`.
* **Lazy Loading:** Fetches child nodes asynchronously only when a parent node is expanded.
* **Keyboard Navigation:** Fully navigable using Arrow keys (Up, Down, Left, Right), Home, End, Enter, and Space.
* **Node Selection:** Supports single node selection via mouse click or keyboard (Enter/Space). Selection state is synchronized with keyboard focus.
* **Expand/Collapse:** Easily expand and collapse nodes with children.
* **Node Metadata:** Supports displaying icons and types associated with nodes.
* **Indentation Lines:** Visual guide lines to indicate hierarchy depth.
* **Node Manipulation API:** Exposes an imperative API via `ref` to programmatically:
    * Add nodes (`addNode`)
    * Remove nodes (`removeNode`)
    * Update node data (`updateNode`)
    * Get node hierarchy path (`getNodeHierarchy`)
    * Expand/Collapse nodes (`expandNode`, `collapseNode`)
    * Select/Deselect nodes (`selectNode`)
* **Node Moving:** Built-in UI to select a node and move it under a different parent.
* **TypeScript:** Written entirely in TypeScript for type safety.
* **Customizable Fetching:** Requires providing functions to fetch top-level and child nodes, allowing integration with any data source or API.

## Installation

1.  **Install Dependencies:**
    ```bash
    npm install @tanstack/react-virtual
    # or
    yarn add @tanstack/react-virtual
    ```
2.  **Copy Component:** Copy the `VirtualizedTreeView.tsx` (or the file containing the component code) and `TreeView.css` files into your project.

## Usage

```typescript
import React, { useRef, useState, useCallback } from 'react';
import VirtualizedTreeView, { TreeNodeData, TreeViewHandle } from './path/to/VirtualizedTreeView'; // Adjust import path
import './path/to/TreeView.css'; // Import the CSS

// 1. Define your data fetching functions
const myFetchTopLevelNodes = async (): Promise<TreeNodeData[]> => {
    // Replace with your actual API call for root nodes
    console.log("Fetching top-level nodes...");
    await new Promise(res => setTimeout(res, 500));
    return [
        // ... return array of TreeNodeData ...
        { id: 'root-1', name: 'Root 1', hasChildren: true, children: null, type: 'folder', icon: '📁' },
    ];
};

const myFetchChildrenForNode = async (parentId: string): Promise<TreeNodeData[]> => {
    // Replace with your actual API call for children
    console.log(`Fetching children for ${parentId}...`);
    await new Promise(res => setTimeout(res, 500));
    if (parentId === 'root-1') {
        return [
             // ... return array of TreeNodeData ...
            { id: 'child-1', name: 'Child 1', hasChildren: false, children: [], type: 'file', icon: '📄' },
        ];
    }
    return [];
};

// 2. Use the component in your application
const MyAppComponent = () => {
    const treeRef = useRef<TreeViewHandle>(null); // Ref for API access
    const [selectedInfo, setSelectedInfo] = useState<string>('None');

    const handleNodeSelect = useCallback((nodeId: string | null, nodeData: TreeNodeData | null) => {
        console.log("Node Selected in App:", nodeId, nodeData);
        setSelectedInfo(nodeData ? `${nodeData.name} (${nodeData.id})` : 'None');
        // Perform actions based on selection
    }, []);

     const handleError = useCallback((error: Error | string) => {
         console.error("Tree View Error in App:", error);
         // Show error UI
     }, []);

     // Example: Button to trigger API
     const selectRootNode = () => {
         treeRef.current?.selectNode('root-1');
     }

    return (
        <div style={{ display: 'flex', height: '500px' }}>
            {/* Example Layout */}
            <div style={{ width: '300px', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column' }}>
                 <VirtualizedTreeView
                    ref={treeRef}
                    fetchTopLevelNodes={myFetchTopLevelNodes}
                    fetchChildrenForNode={myFetchChildrenForNode}
                    onNodeSelect={handleNodeSelect}
                    onError={handleError}
                    containerStyle={{ flexGrow: 1 }} // Make tree fill available space
                 />
                 <button onClick={selectRootNode} style={{margin: '10px'}}>Select Root 1 via API</button>
            </div>
            <div style={{ flexGrow: 1, padding: '20px' }}>
                <h4>Application Content</h4>
                <p>Selected Node: {selectedInfo}</p>
            </div>
        </div>
    );
};

export default MyAppComponent;
```

## Component Props (`VirtualizedTreeViewProps`)

| Prop                    | Type                                                              | Required | Default                  | Description                                                                                                |
| :---------------------- | :---------------------------------------------------------------- | :------- | :----------------------- | :--------------------------------------------------------------------------------------------------------- |
| `fetchTopLevelNodes`    | `() => Promise<TreeNodeData[]>`                                   | Yes      | -                        | Async function to fetch the root-level nodes.                                                              |
| `fetchChildrenForNode`  | `(parentId: string) => Promise<TreeNodeData[]>`                   | Yes      | -                        | Async function to fetch the children for a given parent node ID.                                           |
| `onNodeSelect`          | `(nodeId: string \| null, nodeData: TreeNodeData \| null) => void` | No       | -                        | Callback function triggered when a node is selected or deselected. Passes ID and node data (or nulls).    |
| `onError`               | `(error: Error \| string) => void`                                | No       | -                        | Callback function triggered when an error occurs during data fetching or internal operations.              |
| `initialSelectedNodeId` | `string \| null`                                                  | No       | `null`                   | The ID of the node to be selected initially upon loading.                                                  |
| `containerStyle`        | `CSSProperties`                                                   | No       | `{}`                     | Custom styles to apply to the main wrapper div of the component.                                           |
| `containerClassName`    | `string`                                                          | No       | `''`                     | Custom CSS class name to apply to the main wrapper div.                                                    |
| `hideDefaultControls`   | `boolean`                                                         | No       | `false`                  | Set to `true` to hide the built-in "Move", "Cancel", "Add" buttons (useful when using only the imperative API). |

## Imperative API (`TreeViewHandle`)

You can access these methods using a `ref` attached to the `VirtualizedTreeView` component.

| Method             | Parameters                                                           | Returns         | Description                                                                                                                               |
| :----------------- | :------------------------------------------------------------------- | :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `addNode`          | `(newNodeData: TreeNodeData, parentId?: string \| null)`             | `boolean`       | Adds a new node. `parentId` is `null` or omitted for root level. Returns `true` on success, `false` if parent not found or not loaded. |
| `removeNode`       | `(nodeId: string)`                                                   | `boolean`       | Removes the node with the given ID. Returns `true` on success, `false` if node not found.                                               |
| `updateNode`       | `(nodeId: string, updatedData: Partial<TreeNodeData>)`               | `boolean`       | Updates the data of the node with the given ID (cannot change ID). Returns `true` on success, `false` if node not found.             |
| `getNodeHierarchy` | `(nodeId: string)`                                                   | `string[]|null` | Returns an array of ancestor IDs + the node's own ID, starting from the root. Returns `null` if node not found.                         |
| `expandNode`       | `(nodeId: string, recursive?: boolean = false)`                      | `Promise<void>` | Expands the node with the given ID. Fetches children if needed. If `recursive` is true, attempts to expand all descendants.            |
| `collapseNode`     | `(nodeId: string, recursive?: boolean = false)`                      | `void`          | Collapses the node with the given ID. If `recursive` is true, collapses all descendants as well.                                        |
| `selectNode`       | `(nodeId: string \| null)`                                           | `void`          | Programmatically selects the node with the given ID, or deselects all if `null` is passed.                                                |

## CSS Styling

The component relies on CSS for its appearance and layout. Ensure you import or include the provided `TreeView.css` file, or create your own styles targeting the CSS classes used within the component (e.g., `.tree-view-container`, `.tree-node`, `.node-content`, `.selected`, etc.). The CSS file includes styles for indentation lines, selection, loading spinners, and more.
