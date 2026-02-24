/**
 * Batch Command
 * Wraps multiple commands for atomic batch operations with transaction safety
 */

import type { Command, PhotoState } from "../types";
import { BaseCommand, type Photo, type ApplyFlipsRotationAndCropFn } from "./BaseCommand";
import { updatePhoto } from "../../photoStorage";
import type { Ref } from "vue";

export class BatchCommand extends BaseCommand implements Command {
  private commands: Command[];
  private executedCommands: Command[] = [];

  constructor(
    commands: Command[],
    photos: Ref<Photo[]>,
    updatePhotoFn: typeof updatePhoto,
    applyFlipsRotationAndCropFn: ApplyFlipsRotationAndCropFn
  ) {
    super(photos, updatePhotoFn, applyFlipsRotationAndCropFn);
    this.commands = [...commands];
  }

  async execute(): Promise<void> {
    this.executedCommands = [];

    try {
      // Execute all commands in sequence
      for (const command of this.commands) {
        await command.execute();
        this.executedCommands.push(command);
      }
    } catch (error) {
      // Rollback all executed commands in reverse order
      for (let i = this.executedCommands.length - 1; i >= 0; i--) {
        try {
          await this.executedCommands[i].undo();
        } catch (rollbackError) {
          console.error("Rollback failed for command:", rollbackError);
          // Continue rolling back other commands even if one fails
        }
      }
      this.executedCommands = [];
      throw error; // Re-throw original error
    }
  }

  async undo(): Promise<void> {
    // Undo all commands in reverse order
    for (let i = this.executedCommands.length - 1; i >= 0; i--) {
      await this.executedCommands[i].undo();
    }
    // Reverse the executed commands array for potential redo
    this.executedCommands.reverse();
  }

  validate(): boolean {
    // All commands must be valid
    return this.commands.every((cmd) => cmd.validate()) && this.commands.length > 0;
  }

  getAffectedPhotoIds(): string[] {
    // Get unique photo IDs from all commands
    const photoIds = new Set<string>();
    for (const command of this.commands) {
      for (const photoId of command.getAffectedPhotoIds()) {
        photoIds.add(photoId);
      }
    }
    return Array.from(photoIds);
  }

  getDescription(): string {
    return `Batch operation (${this.commands.length} command(s))`;
  }

  captureState(): Map<string, PhotoState> {
    const states = new Map<string, PhotoState>();
    for (const command of this.commands) {
      const commandState = command.captureState?.();
      if (commandState instanceof Map) {
        for (const [photoId, state] of commandState) {
          states.set(photoId, state);
        }
      }
    }
    return states;
  }
}
