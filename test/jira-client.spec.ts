import {ConfigProvider, Effect, Either, Layer} from 'effect';
import * as Http from '@effect/platform/HttpClient';

import {Environment, EnvironmentLive} from '../src/environment';
import {JiraClient, JiraClientLive} from '../src/jira-client';
import {JiraApiError, JiraIssue} from '../src/types';

import {describe, expect} from 'vitest';
import {itEffect} from './util';

const environmentTest = EnvironmentLive.pipe(
  Layer.provide(
    Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([
          ['JIRA_PAT', 'dummy-jira-pat'],
          ['JIRA_API_URL', 'https://dummy-jira-instance.com'],
          ['JIRA_KEY_PREFIX', 'DUMMYAPP'],
        ]),
      ),
    ),
  ),
);

const mkHttpMock = (
  response: Response,
): Layer.Layer<never, never, Http.client.Client.Default> =>
  Layer.succeed(
    Http.client.Client,
    Http.client.makeDefault((req) =>
      Effect.succeed(Http.response.fromWeb(req, response)),
    ),
  );

const mkTestLayer = (
  response: Response,
): Layer.Layer<
  never,
  never,
  Environment | Http.client.Client.Default | JiraClient
> => {
  const baseTestLayer = Layer.merge(environmentTest, mkHttpMock(response));
  return Layer.merge(
    baseTestLayer,
    JiraClientLive.pipe(Layer.provide(baseTestLayer)),
  );
};

const testProg = Effect.gen(function* ($) {
  const jiraClient = yield* $(JiraClient);
  const ticket = yield* $(jiraClient.getJiraIssue('DUMMYAPP-123'));
  return ticket;
});

describe('JiraClient', () => {
  itEffect('should make ticket request', () =>
    Effect.gen(function* ($) {
      const testIssue: JiraIssue = {
        key: 'DUMMYAPP-123',
        fields: {
          summary: 'Dummy isssue summary',
          issuetype: {
            name: 'Feature',
          },
        },
      };

      const res = yield* $(
        Effect.either(
          Effect.provide(testProg, mkTestLayer(Response.json(testIssue))),
        ),
      );

      Either.match(res, {
        onLeft: (e) =>
          expect.unreachable(`Should have returned a ticket: ${e}`),
        onRight: (ticket) => expect(ticket).toEqual(testIssue),
      });
    }),
  );

  itEffect('should handle BadRequest errors', () =>
    Effect.gen(function* ($) {
      const testIssue: Partial<JiraIssue> = {
        fields: {
          summary: 'Dummy isssue summary',
          issuetype: {
            name: 'Feature',
          },
        },
      };

      const res = yield* $(
        Effect.either(
          Effect.provide(testProg, mkTestLayer(Response.json(testIssue))),
        ),
      );

      Either.match(res, {
        onLeft: (e) =>
          expect(e).toEqual(
            JiraApiError({
              message:
                "Failed to parse ticket response from Jira:\n'key': 'Missing key or index'",
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error.'),
      });
    }),
  );

  itEffect('should return ParseError for invalid response', () =>
    Effect.gen(function* ($) {
      const testIssue: Partial<JiraIssue> = {
        fields: {
          summary: 'Dummy isssue summary',
          issuetype: {
            name: 'Feature',
          },
        },
      };

      const res = yield* $(
        Effect.either(
          Effect.provide(testProg, mkTestLayer(Response.json(testIssue))),
        ),
      );

      Either.match(res, {
        onLeft: (e) =>
          expect(e).toEqual(
            JiraApiError({
              message:
                "Failed to parse ticket response from Jira:\n'key': 'Missing key or index'",
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error.'),
      });
    }),
  );

  itEffect('should handle 404 NOT_FOUND errors', () =>
    Effect.gen(function* ($) {
      const failedResponse = new Response(null, {status: 404});

      const res = yield* $(
        Effect.either(Effect.provide(testProg, mkTestLayer(failedResponse))),
      );

      Either.match(res, {
        onLeft: (e) =>
          expect(e).toEqual(
            JiraApiError({
              message: 'Jira returned status 404. Make sure the ticket exists.',
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error.'),
      });
    }),
  );

  itEffect('should return error for response with non 200 status', () =>
    Effect.gen(function* ($) {
      const failedResponse = new Response(null, {status: 500});

      const res = yield* $(
        Effect.either(Effect.provide(testProg, mkTestLayer(failedResponse))),
      );

      Either.match(res, {
        onLeft: (e) =>
          expect(e).toEqual(
            JiraApiError({
              message:
                'Jira Ticket request returned failure. Reason: StatusCode (non 2xx status code) StatusCode: 500',
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error.'),
      });
    }),
  );
});
