import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { toggleReverseForClips } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class ToggleReverseCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return toggleReverseForClips(current, this.clipIds);
  }

  getDescription(): string {
    return `Reverse ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`;
  }
}
