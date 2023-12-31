import {Layer, Context, Effect, flow} from 'effect';
import * as Http from '@effect/platform/HttpClient';
// eslint-disable-next-line node/no-extraneous-import
import * as ArrayFormatter from '@effect/schema/ArrayFormatter';
// eslint-disable-next-line node/no-extraneous-import
import * as ParseResult from '@effect/schema/ParseResult';

import {Environment} from './environment';
import {
  AppConfigError,
  JiraApiError,
  JiraAuth,
  JiraIssue,
  JiraIssueSchema,
} from './types';

export interface JiraClient {
  readonly getJiraIssue: (
    issueKey: string,
  ) => Effect.Effect<Environment, AppConfigError | JiraApiError, JiraIssue>;
}

export const JiraClient = Context.Tag<JiraClient>();

export const JiraClientLive = Layer.effect(
  JiraClient,
  Effect.all([Environment, Http.client.Client]).pipe(
    Effect.map(([env, httpClient]) =>
      JiraClient.of({
        getJiraIssue: (issueId: string) =>
          Effect.gen(function* (_) {
            const endPoint = `/rest/api/latest/issue/${issueId}`;
            const {jiraAuth, jiraApiUrl} = yield* _(env.getEnv());

            return yield* _(
              Http.request
                .get(jiraApiUrl + endPoint, {
                  headers: {
                    Authorization: buildJiraAuthorizationHeader(jiraAuth),
                    Accept: 'application/json',
                  },
                })
                .pipe(
                  Http.client.filterStatusOk(httpClient),
                  Effect.flatMap(Http.response.schemaBodyJson(JiraIssueSchema)),
                  handleJiraClientErrors,
                ),
            );
          }),
      }),
    ),
  ),
);

const buildJiraAuthorizationHeader = (jiraAuth: JiraAuth): string => {
  switch (jiraAuth._tag) {
    case 'JiraCloudAuth':
      return `Basic ${Buffer.from(
        `${jiraAuth.jiraUserEmail}:${jiraAuth.jiraApiToken}`,
      ).toString('base64')}`;
    case 'JiraDataCenterAuth':
      return `Bearer ${jiraAuth.jiraPat}`;
  }
};

const handleJiraClientErrors: (
  eff: Effect.Effect<
    Environment,
    AppConfigError | ParseResult.ParseError | Http.error.HttpClientError,
    JiraIssue
  >,
) => Effect.Effect<Environment, AppConfigError | JiraApiError, JiraIssue> =
  flow(
    Effect.catchTag('ParseError', (e) =>
      Effect.fail(
        JiraApiError({
          message: [
            'Failed to parse ticket response from Jira:',
            ...ArrayFormatter.formatErrors(e.errors).map(
              (issue) => `'${issue.path.join(' ')}': '${issue.message}'`,
            ),
          ].join('\n'),
        }),
      ),
    ),
    Effect.catchTag('RequestError', (e) =>
      Effect.fail(
        JiraApiError({
          message: `Failed to make ticket request to Jira. Reason: ${e.reason}`,
        }),
      ),
    ),
    Effect.catchTag('ResponseError', (e) =>
      Effect.fail(
        JiraApiError({
          message:
            e.response.status === 404
              ? 'Jira returned status 404. Make sure the ticket exists.'
              : `Jira Ticket request returned failure. Reason: ${e.reason}${
                  typeof e.error === 'string' ? ` (${e.error})` : ''
                } StatusCode: ${e.response.status}`,
        }),
      ),
    ),
  );
