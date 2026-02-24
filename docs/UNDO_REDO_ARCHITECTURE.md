# Undo/Redo System Architecture

## Overview

This document outlines the recommended architecture for implementing a professional undo/redo system for JustCropIt photo editor.

## Design Principles

1. **Memory Efficiency**: Store state snapshots, not full image blobs
2. **Command Pattern**: Encapsulate operations as reversible commands
3. **Scalability**: Support individual and batch operations
4. **Clean Architecture**: Separate concerns with dedicated utilities
5. **Performance**: Efficient state diffing and restoration
6. **User Experience**: Keyboard shortcuts and visual feedback

## Architecture Recommendation

### Option 1: Command Pattern with State Snapshots (RECOMMENDED)

**Advantages:**
- Clean separation of concerns
- Easy to extend with new operations
- Memory efficient (stores state, not images)
- Professional, maintainable code
- Supports complex operations (batch, multi-photo)

**Implementation Structure:**

```
src/utils/undoRedoManager.ts
  - UndoRedoManager class
  - Command interface
  - State snapshot management
  - History stack management

src/utils/commands/
  - FlipCommand.ts
  - CropCommand.ts
  - RotateCommand.ts
  - PasteSettingsCommand.ts
  - BatchCommand.ts (wrapper for batch operations)
```

### Option 2: Simple State Stack (Simpler, but less maintainable)

**Advantages:**
- Quick to implement
- Less code overhead

**Disadvantages:**
- Harder to maintain
- Less flexible
- More difficult to handle batch operations

## Recommended Implementation: Command Pattern

### 1. Core Data Structures

```typescript
// State snapshot for a single photo
interface PhotoState {
  flips: { horizontal: boolean; vertical: boolean };
  crop?: { x: number; y: number; width: number; height: number };
  rotation?: number;
  // Note: We don't store File/Blob - we regenerate from original + state
}

// Command interface
interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
  getDescription(): string;
}

// History entry
interface HistoryEntry {
  command: Command;
  timestamp: number;
  affectedPhotoIndices: number[];
}
```

### 2. UndoRedoManager Class

```typescript
class UndoRedoManager {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number = 50; // Configurable limit
  
  async executeCommand(command: Command): Promise<void> {
    await command.execute();
    this.undoStack.push({
      command,
      timestamp: Date.now(),
      affectedPhotoIndices: command.getAffectedIndices()
    });
    this.redoStack = []; // Clear redo stack on new action
    this.enforceMaxSize();
  }
  
  async undo(): Promise<boolean> {
    if (this.undoStack.length === 0) return false;
    const entry = this.undoStack.pop()!;
    await entry.command.undo();
    this.redoStack.push(entry);
    return true;
  }
  
  async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) return false;
    const entry = this.redoStack.pop()!;
    await entry.command.execute();
    this.undoStack.push(entry);
    return true;
  }
  
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  
  private enforceMaxSize(): void {
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift(); // Remove oldest entry
    }
  }
  
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
```

### 3. Command Implementation Example

```typescript
class FlipCommand implements Command {
  constructor(
    private photos: Ref<Photo[]>,
    private photoIndex: number,
    private direction: 'horizontal' | 'vertical',
    private applyFlipsRotationAndCrop: Function
  ) {}
  
  private previousState: PhotoState | null = null;
  
  async execute(): Promise<void> {
    const photo = this.photos.value[this.photoIndex];
    this.previousState = {
      flips: { ...photo.flips },
      crop: photo.crop ? { ...photo.crop } : undefined,
      rotation: photo.rotation
    };
    
    // Apply flip (existing logic)
    // ... flip implementation
  }
  
  async undo(): Promise<void> {
    if (!this.previousState) return;
    // Restore previous state
    const photo = this.photos.value[this.photoIndex];
    // Regenerate current File from original + previousState
    // ... undo logic
  }
  
  getAffectedIndices(): number[] {
    return [this.photoIndex];
  }
  
  getDescription(): string {
    return `Flip ${this.direction} on photo ${this.photoIndex}`;
  }
}
```

## Implementation Strategy

### Phase 1: Core Infrastructure
1. Create `src/utils/undoRedoManager.ts`
2. Implement UndoRedoManager class
3. Create Command interface
4. Set up keyboard shortcuts (Ctrl+Z, Ctrl+Y)

### Phase 2: Basic Commands
1. Implement FlipCommand
2. Implement CropCommand  
3. Implement PasteSettingsCommand
4. Wire up to existing handlers

### Phase 3: Advanced Features
1. BatchCommand wrapper for batch operations
2. State regeneration logic
3. Memory management and limits
4. UI buttons for undo/redo

### Phase 4: Polish
1. Visual feedback (disabled states)
2. Keyboard shortcuts
3. History limit management
4. Performance optimization

## Key Considerations

### Memory Management
- **Don't store File/Blob objects in history** - regenerate from original + state
- Use state snapshots (flips, crop, rotation) instead
- Implement history size limits
- Clean up old history entries

### State Regeneration
- Store original File (already done)
- Store state: flips, crop, rotation
- Regenerate `current` File on undo/redo using existing transformation functions

### Batch Operations
- Wrap multiple commands in BatchCommand
- Undo/redo entire batch as one unit
- Or implement as single atomic operation

### Integration Points
- Wrap existing handlers (handleFlip, handleCrop, etc.)
- Use command pattern instead of direct state manipulation
- Maintain backward compatibility during migration

## File Structure

```
src/
  utils/
    undoRedoManager.ts          # Core manager class
    commands/
      BaseCommand.ts            # Base command class
      FlipCommand.ts
      CropCommand.ts
      RotateCommand.ts
      PasteSettingsCommand.ts
      BatchCommand.ts
      index.ts                  # Export all commands
```

## Next Steps

1. Review and approve this architecture
2. Start with Phase 1: Core Infrastructure
3. Create base Command interface and UndoRedoManager
4. Implement one command (FlipCommand) as proof of concept
5. Gradually migrate other operations
6. Add UI and keyboard shortcuts

## Alternative: Hybrid Approach (Simpler Start)

If Command Pattern seems too complex initially, we can:

1. Start with simple state snapshots
2. Store PhotoState[] for each history entry
3. Implement undo/redo as state restoration
4. Refactor to Command Pattern later

This gives faster initial implementation but requires refactoring later.
