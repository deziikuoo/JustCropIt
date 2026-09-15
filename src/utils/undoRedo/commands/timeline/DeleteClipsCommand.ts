import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { deleteClips } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class DeleteClipsCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return deleteClips(current, this.clipIds);
  }

  getDescription(): string {
    return `Delete ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`;
  }
}
