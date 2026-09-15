/**
 * Base class for hidden Edit tab timeline commands.
 *
 * Reuses the generic `Command` interface + `UndoRedoManager` from
 * src/utils/undoRedo/ — a fresh manager instance is created per Edit-tab
 * session (see useVideoTimelineEditor.ts), entirely separate from photo undo.
 *
 * Clip metadata is cheap (no blobs), so every command just snapshots the
 * whole `clips` array before/after — no need for command-specific diffing.
 */
import type { Ref } from 'vue';
import type { Command } from '../../types';
import type { Clip } from '../../../../types/videoEdit';

export abstract class TimelineCommandBase implements Command {
  private before: Clip[] = [];

  constructor(protected clips: Ref<Clip[]>) {}

  /** Returns the new clips array given the current one. */
  protected abstract apply(current: Clip[]): Clip[];

  abstract getDescription(): string;

  validate(): boolean {
    return true;
  }

  /** Unused for timeline commands — required by the shared Command interface. */
  getAffectedPhotoIds(): string[] {
    return [];
  }

  async execute(): Promise<void> {
    this.before = this.clips.value;
    this.clips.value = this.apply(this.clips.value);
  }

  async undo(): Promise<void> {
    this.clips.value = this.before;
  }
}
