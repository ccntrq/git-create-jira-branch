import {Option, Data, Effect, pipe} from 'effect';
import {ValidationError} from '@effect/cli';
import {CliApp} from '@effect/cli/CliApp';
import * as Args from '@effect/cli/Args';
import * as Command from '@effect/cli/Command';
import * as Options from '@effect/cli/Options';
import * as Span from '@effect/cli/HelpDoc/Span';
import * as HelpDoc from '@effect/cli/HelpDoc';

import {gitCreateJiraBranch} from './core';
import * as packageJson from '../package.json';
import {matchGitCreateJiraBranchResult} from './types';
import {compose} from 'effect/Function';
import {Environment} from './environment';
import {GitClient} from './git-client';
import {JiraClient} from './jira-client';

interface GitCreateJiraBranch extends Data.Case {
  readonly version: boolean;
  readonly jiraKey: Option.Option<string>;
  readonly baseBranch: Option.Option<string>;
  readonly reset: boolean;
}

const GitCreateJiraBranch = Data.case<GitCreateJiraBranch>();

const mainCommand = pipe(
  Command.make(
    'git-create-jira-branch',
    {
      options: Options.all({
        baseBranch: Options.withDescription(
          Options.optional(Options.withAlias(Options.text('baseBranch'), 'b')),
          'Base branch to create the new branch from',
        ),
        reset: Options.withDescription(
          Options.withAlias(Options.boolean('reset'), 'r'),
          'Reset the branch if it already exists',
        ),
        version: Options.withDescription(
          Options.withAlias(Options.boolean('version'), 'v'),
          'Show version information',
        ),
        help: Options.withDescription(
          Options.withAlias(Options.boolean('help'), 'h'),
          'Show this help text',
        ),
      }),
      args: Args.withDescription(
        Args.atMost(Args.text({name: 'jira-key'}), 1),
        'The Jira ticket key to create a branch for (e.g. FOOX-1234)',
      ),
    },
    (args) => {
      const command = GitCreateJiraBranch({
        version: args.options.version,
        baseBranch: args.options.baseBranch,
        reset: args.options.reset,
        jiraKey: Option.fromNullable(args.args[0]),
      });

      if (command.version) {
        return Effect.log(`${cli.name} v${cli.version}`);
      }

      return Option.match(command.jiraKey, {
        onSome: (jiraKey) =>
          Effect.flatMap(
            gitCreateJiraBranch(jiraKey, command.baseBranch, command.reset),
            compose(
              matchGitCreateJiraBranchResult({
                onCreatedBranch: (branch) =>
                  `Successfully created branch: '${branch}'`,
                onSwitchedBranch: (branch) =>
                  `Switched to already existing branch: '${branch}'`,
                onResetBranch: (branch) => `Reset branch: '${branch}'`,
              }),
              Effect.log,
            ),
          ),
        onNone: () => printDocs(HelpDoc.p(Span.error('No Jira Key provided'))),
      });
    },
  ),
  Command.withDescription(
    HelpDoc.p(
      `Fetches the given Jira ticket and creates an aproriately named branch for it.
The branch type (bug or feat) is determined by the ticket type. The branch name
is based on the ticket summary.`,
    ),
  ),
);

const cli = {
  name: packageJson.name,
  version: packageJson.version,
  summary: Span.text(packageJson.description),
};

export const cliEffect = (
  args: string[],
): Effect.Effect<
  CliApp.Environment | GitClient | Environment | JiraClient,
  never,
  void
> =>
  Command.run(
    mainCommand,
    cli,
  )(args).pipe(
    Effect.catchIf(ValidationError.isValidationError, (e) =>
      // TODO: handle error
      Effect.log(e),
    ),
    Effect.catchAll((e) => printDocs(HelpDoc.p(Span.error(e.message)))),
  );

const printDocs = (doc: HelpDoc.HelpDoc): Effect.Effect<never, never, void> =>
  Effect.log(HelpDoc.toAnsiText(doc));
