import {ValidationError} from '@effect/cli';
import * as Args from '@effect/cli/Args';
import type {CliApp} from '@effect/cli/CliApp';
import * as Command from '@effect/cli/Command';
import * as HelpDoc from '@effect/cli/HelpDoc';
import * as Span from '@effect/cli/HelpDoc/Span';
import * as Options from '@effect/cli/Options';
import type * as CommandExecutor from '@effect/platform/CommandExecutor';
import {Chunk, Console, Effect, Option, pipe} from 'effect';
import {compose, constant, flow} from 'effect/Function';

import * as packageJson from '../package.json';
import type {AppConfigService} from './app-config';
import {
  getAssociatedBranches,
  gitCreateJiraBranch,
  ticketInfo,
  ticketInfoForCurrentBranch,
  ticketUrl,
  ticketUrlForCurrentBranch,
} from './core';
import type {GitClient} from './git-client';
import {formatIssue} from './issue-formatter';
import type {JiraClient} from './jira-client';
import {matchGitCreateJiraBranchResult} from './types';
import {openUrl} from './url-opener';
import {Doc} from '@effect/printer';
import {render} from '@effect/printer-ansi/AnsiDoc';
import {green} from '@effect/printer-ansi/Ansi';
import {formatBranches} from './branch-formatter';

// for version and help
const gitJiraBranch = pipe(Command.make('git-jira-branch', {}));

const createCommand = pipe(
  Command.make(
    'create',
    {
      options: Options.all({
        baseBranch: Options.withDescription(
          Options.optional(Options.withAlias(Options.text('base'), 'b')),
          'Base revision to create the new branch from (a branch name, tag or commit SHA)',
        ),
        reset: Options.withDescription(
          Options.withAlias(Options.boolean('reset'), 'r'),
          'Reset the branch if it already exists',
        ),
      }),
      jiraKey: Args.withDescription(
        Args.text({name: 'jira-key'}),
        'The Jira ticket key to create a branch for (e.g. FOOX-1234)',
      ),
    },
    ({options, jiraKey}) => {
      return Effect.flatMap(
        gitCreateJiraBranch(jiraKey, options.baseBranch, options.reset),
        compose(
          matchGitCreateJiraBranchResult({
            onCreatedBranch: (branch) =>
              `Successfully created branch: '${branch}'`,
            onSwitchedBranch: (branch) =>
              `Switched to already existing branch: '${branch}'`,
            onResetBranch: (branch) => `Reset branch: '${branch}'`,
          }),
          Console.log,
        ),
      );
    },
  ),
  Command.withDescription(
    `
Fetches the given Jira ticket and creates an aproriately named branch for it.
The branch type (bug or feat) is determined by the ticket type. The branch name
is based on the ticket summary.`,
  ),
);

const openCommand = pipe(
  Command.make(
    'open',
    {
      jiraKey: Args.withDescription(
        Args.optional(Args.text({name: 'jira-key'})),
        'The Jira key for the ticket to open (e.g. FOOX-1234)',
      ),
    },
    ({jiraKey}) =>
      pipe(
        jiraKey,
        Option.match({
          onSome: (jiraKey) => ticketUrl(jiraKey),
          onNone: () => ticketUrlForCurrentBranch(),
        }),
        Effect.tap((url) =>
          Console.log(`Opening ticket url '${url}' in your default browser...`),
        ),
        Effect.flatMap(openUrl),
      ),
  ),
  Command.withDescription(
    `
Opens the given Jira ticket in your default browser. If no ticket is given the
jira ticket for the current branch is opened.`,
  ),
);

const infoCommand = pipe(
  Command.make(
    'info',
    {
      jiraKey: Args.withDescription(
        Args.optional(Args.text({name: 'jira-key'})),
        'The Jira key for the ticket to get information for (e.g. FOOX-1234)',
      ),
    },
    ({jiraKey}) =>
      pipe(
        jiraKey,
        Option.match({
          onSome: ticketInfo,
          onNone: () => ticketInfoForCurrentBranch(),
        }),
        Effect.map(formatIssue),
        Effect.flatMap(Console.log),
      ),
  ),
  Command.withDescription(
    `
Displays information for the given Jira ticket on your terminal. If no ticket is
provided, it presents information for the Jira ticket associated with the
current branch.`,
  ),
);

const listCommand = pipe(
  Command.make('list', {}, () =>
    pipe(
      getAssociatedBranches(),
      Effect.map(formatBranches),
      Effect.flatMap(Console.log),
    ),
  ),
  Command.withDescription(
    `
Lists all branches that appear to be associated with a Jira ticket.`,
  ),
);

const mainCommand = gitJiraBranch.pipe(
  Command.withSubcommands([
    createCommand,
    openCommand,
    infoCommand,
    listCommand,
  ]),
);

const cli = {
  name: packageJson.name,
  version: packageJson.version,
  summary: Span.text(packageJson.description),
};

export const cliEffect = (
  args: Array<string>,
): Effect.Effect<
  void,
  never,
  | CliApp.Environment
  | GitClient
  | AppConfigService
  | JiraClient
  | CommandExecutor.CommandExecutor
> =>
  Command.run(
    mainCommand,
    cli,
  )(args).pipe(
    Effect.catchIf(
      ValidationError.isValidationError,
      // handled and printed by the cli library already
      constant(Effect.unit),
    ),
    Effect.catchAll((e) => printDocs(HelpDoc.p(Span.error(e.message)))),
  );

const printDocs = (doc: HelpDoc.HelpDoc): Effect.Effect<void> =>
  Console.log(HelpDoc.toAnsiText(doc));
