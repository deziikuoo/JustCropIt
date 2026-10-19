import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { ungroupClips } from '../../../videoEdit/compoundClip';
import { TimelineCommandBase } from './TimelineCommandBase';

export class UngroupClipsCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return ungroupClips(current, this.clipIds);
  }

  getDescription(): string {
    return 'Ungroup compound clip';
  }
}
