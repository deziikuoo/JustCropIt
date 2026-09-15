import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { splitAtTimelineTime } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class SplitClipCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private timelineTime: number) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return splitAtTimelineTime(current, this.timelineTime);
  }

  getDescription(): string {
    return `Split clip at ${this.timelineTime.toFixed(2)}s`;
  }
}
