import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { setSpeedForClips } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class SetSpeedCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>, private clipIds: ReadonlySet<string>, private speed: number) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return setSpeedForClips(current, this.clipIds, this.speed);
  }

  getDescription(): string {
    return `Set speed to ${this.speed}x on ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`;
  }
}
