import type { Ref } from 'vue';
import type { Clip } from '../../../../types/videoEdit';
import { autoBuildClips } from '../../../videoEdit/autoBuild';
import { TimelineCommandBase } from './TimelineCommandBase';

export class AutoBuildCommand extends TimelineCommandBase {
  constructor(clips: Ref<Clip[]>) {
    super(clips);
  }

  protected apply(current: Clip[]): Clip[] {
    return autoBuildClips(current);
  }

  getDescription(): string {
    return 'Auto Build boomerang loops';
  }
}
