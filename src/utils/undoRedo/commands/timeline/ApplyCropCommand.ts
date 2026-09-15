import type { Ref } from 'vue';
import type { Clip, CropBox } from '../../../../types/videoEdit';
import { applyCropToClips } from '../../../videoEdit/clipMath';
import { TimelineCommandBase } from './TimelineCommandBase';

export class ApplyCropCommand extends TimelineCommandBase {
  constructor(
    clips: Ref<Clip[]>,
    private clipIds: ReadonlySet<string>,
    private crop: CropBox | undefined
  ) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return applyCropToClips(current, this.clipIds, this.crop);
  }

  getDescription(): string {
    return this.crop
      ? `Crop ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`
      : `Clear crop on ${this.clipIds.size} clip${this.clipIds.size === 1 ? '' : 's'}`;
  }
}
