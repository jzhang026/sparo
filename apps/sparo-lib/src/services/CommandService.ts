import { inject } from 'inversify';
import type { Argv } from 'yargs';
import type { ICommand } from '../cli/commands/base';
import { TerminalService } from './TerminalService';
import { Service } from '../decorator';
import { ArgvService } from './ArgvService';
import { Stopwatch } from '../logic/Stopwatch';
import { TelemetryService } from './TelemetryService';
import { getCommandName } from '../cli/commands/util';

export interface ICommandServiceParams {
  yargs: Argv<{}>;
  terminalService: TerminalService;
}

export interface ICommandInfo {
  name: string;
  description: string;
}

@Service()
export class CommandService {
  @inject(ArgvService) private _yargs!: ArgvService;
  @inject(TerminalService) private _terminalService!: TerminalService;
  @inject(TelemetryService) private _telemetryService!: TelemetryService;
  private _hasInternalError: boolean = false;
  private _commandInfos: Map<string, ICommandInfo> = new Map<string, ICommandInfo>();

  public register<O extends {}>(command: ICommand<O>): void {
    const { cmd, description, builder, handler } = command;
    const { _terminalService: terminalService } = this;
    const { terminal } = terminalService;
    const commandName: string = getCommandName(cmd);
    this._commandInfos.set(commandName, {
      name: commandName,
      description
    });
    this._yargs.yargsArgv.command<O>(
      cmd,
      description,
      (yargs: Argv<{}>) => {
        yargs.version(false);
        builder(yargs as unknown as Argv<O>);
      },
      async (args) => {
        process.exitCode = 1;
        this._hasInternalError = false;
        try {
          terminal.writeVerboseLine(`Invoking command "${commandName}" with args ${JSON.stringify(args)}`);
          const stopwatch: Stopwatch = Stopwatch.start();
          await handler(args, terminalService);
          terminal.writeVerboseLine(`Invoked command "${commandName}" done (${stopwatch.toString()})`);
          stopwatch.stop();
          if (!this._hasInternalError) {
            // Only report success data
            this._telemetryService.collectTelemetry({
              commandName,
              args: process.argv.slice(2),
              durationInSeconds: stopwatch.duration,
              startTimestampMs: stopwatch.startTime,
              endTimestampMs: stopwatch.endTime
            });
          }
          // eslint-disable-next-line require-atomic-updates
          process.exitCode = 0;
        } catch (e) {
          // @todo: `e` from git service is undefined sometime
          // to reproduce try call `auto-config` command
          if (typeof e !== 'undefined') terminal.writeErrorLine((e as Error).message);
        }
      }
    );
  }

  public setHasInternalError(): void {
    this._hasInternalError = true;
  }

  public get commandInfos(): Map<string, ICommandInfo> {
    return this._commandInfos;
  }
}
