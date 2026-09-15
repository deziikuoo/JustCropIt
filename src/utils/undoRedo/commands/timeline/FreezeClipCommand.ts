import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { insertFreezeClip } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class FreezeClipCommand extends TimelineCommandBase {
  constructor(
    clips: Ref<Clip[]>,
    private timelineTime: number,
    private durationSeconds: number
  ) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return insertFreezeClip(current, this.timelineTime, this.durationSeconds);
  }

  getDescription(): string {
    return `Freeze frame at ${this.timelineTime.toFixed(2)}s for ${this.durationSeconds}s`;
  }
}
