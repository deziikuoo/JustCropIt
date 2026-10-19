import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { combineClips } from '../../../videoEdit/compoundClip';
import { TimelineCommandBase } from './TimelineCommandBase';

export class CombineClipsCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return combineClips(current, this.clipIds);
  }

  getDescription(): string {
    return `Combine ${this.clipIds.size} clips`;
  }
}
