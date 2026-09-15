import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { duplicateClips } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class DuplicateClipsCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return duplicateClips(current, this.clipIds);
  }

  getDescription(): string {
    return `Duplicate ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`;
  }
}
