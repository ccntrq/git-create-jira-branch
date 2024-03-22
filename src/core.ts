import {Chunk, Effect, Option} from 'effect';
import {constant, pipe} from 'effect/Function';
import {isNone} from 'effect/Option';

import {AppConfigService} from './app-config';
import {GitClient} from './git-client';
import {JiraClient} from './jira-client';
import {
  type AppConfigError,
  CreatedBranch,
  type GitCreateJiraBranchResult,
  type GitExecError,
  type GitJiraBranchError,
  type JiraIssue,
  type JiraIssuetype,
  ResetBranch,
  SwitchedBranch,
  UsageError,
} from './types';

export const gitCreateJiraBranch = (
  jiraKey: string,
  baseBranch: Option.Option<string>,
  reset: boolean,
): Effect.Effect<
  GitCreateJiraBranchResult,
  GitJiraBranchError,
  AppConfigService | GitClient | JiraClient
> =>
  Effect.gen(function* ($) {
    const [gitClient, jiraClient] = yield* $(
      Effect.all([GitClient, JiraClient]),
    );

    const issue = yield* $(
      fullKey(jiraKey),
      Effect.flatMap(jiraClient.getJiraIssue),
    );

    const branchName = jiraIssueToBranchName(issue);

    const branchExists = yield* $(
      Effect.map(gitClient.listBranches(), Chunk.contains(branchName)),
    );

    if (!reset && branchExists) {
      yield* $(gitClient.switchBranch(branchName));
      return SwitchedBranch({branch: branchName});
    }

    const resetBranch = branchExists && reset;

    yield* $(
      Option.match(baseBranch, {
        onNone: constant(gitClient.createGitBranch),
        onSome: gitClient.createGitBranchFrom,
      })(branchName, resetBranch),
    );

    return (resetBranch ? ResetBranch : CreatedBranch)({branch: branchName});
  });

const getJiraKeyFromCurrentBranch = (): Effect.Effect<
  string,
  UsageError | GitExecError,
  GitClient
> =>
  pipe(
    GitClient,
    Effect.flatMap((_) => _.getCurrentBranch()),
    Effect.map(extractJiraKey),
    Effect.flatMap((key) =>
      Option.match({
        onNone: () =>
          Effect.fail(
            UsageError({message: 'No Jira Key found in current branch'}),
          ),
        onSome: (key: string) => Effect.succeed(key),
      })(key),
    ),
  );

export const ticketUrlForCurrentBranch = (): Effect.Effect<
  string,
  GitJiraBranchError,
  AppConfigService | GitClient
> => getJiraKeyFromCurrentBranch().pipe(Effect.flatMap(ticketUrl));

export const ticketUrl = (
  jiraKey: string,
): Effect.Effect<string, AppConfigError, AppConfigService> =>
  pipe(jiraKey, fullKey, Effect.flatMap(buildTicketUrl));

export const ticketInfoForCurrentBranch = () =>
  getJiraKeyFromCurrentBranch().pipe(Effect.flatMap(ticketInfo));

export const ticketInfo = (jiraKey: string) =>
  Effect.gen(function* ($) {
    const jiraClient = yield* $(JiraClient);

    const issue = yield* $(
      fullKey(jiraKey),
      Effect.flatMap(jiraClient.getJiraIssue),
    );

    return issue;
  });

export const getAssociatedBranches = (): Effect.Effect<
  Chunk.Chunk<GitBranch>,
  GitExecError,
  GitClient
> =>
  GitClient.pipe(
    Effect.flatMap((_) => _.listBranches()),
    Effect.map((branches) =>
      Chunk.filter(branches, (branch) =>
        Option.isSome(extractJiraKey(branch.name)),
      ),
    ),
  );

const fullKey = (
  jiraKey: string,
): Effect.Effect<string, AppConfigError, AppConfigService> =>
  AppConfigService.pipe(
    Effect.flatMap((_) => _.getAppConfig),
    Effect.map(({defaultJiraKeyPrefix}) =>
      jiraKey.match(/^([a-z]+)-(\d+)$/i) || isNone(defaultJiraKeyPrefix)
        ? jiraKey
        : `${defaultJiraKeyPrefix.value}-${jiraKey}`,
    ),
  );

const slugify = (str: string): string =>
  str
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const jiraIssueToBranchName = (issue: JiraIssue): string => {
  const branchtype = jiraIssuetypeBranchtype(issue.fields.issuetype);
  return `${branchtype}/${issue.key}-${slugify(issue.fields.summary)}`;
};

const jiraIssuetypeBranchtype = (issuetype: JiraIssuetype): string => {
  if (issuetype.name.match(/bug/i)) {
    return 'fix';
  }

  return 'feat';
};

const buildTicketUrl = (
  jiraKey: string,
): Effect.Effect<string, AppConfigError, AppConfigService> =>
  AppConfigService.pipe(
    Effect.flatMap((_) => _.getAppConfig),
    Effect.map(({jiraApiUrl}) => `${jiraApiUrl}/browse/${jiraKey}`),
  );

function extractJiraKey(branchName: string): Option.Option<string> {
  const res = branchName.match(/^(?:\w+\/)?([A-Z]+-\d+)/);
  return Option.fromNullable(res?.[1]);
}
