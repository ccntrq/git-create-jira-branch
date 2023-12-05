import {Environment, EnvironmentLive} from '../src/environment';
import {ConfigProvider, Effect, Either, Layer} from 'effect';
import * as Option from 'effect/Option';
import {describe, expect} from 'vitest';
import {itEffect} from './util';
import {AppConfigError} from '../src/types';

const testProg = Effect.all([Environment]).pipe(
  Effect.flatMap(([env]) => env.getEnv()),
);

const mkTestLayer = (
  configProvider: ConfigProvider.ConfigProvider,
): Layer.Layer<never, never, Environment> =>
  EnvironmentLive.pipe(Layer.provide(Layer.setConfigProvider(configProvider)));

describe('Environment', () => {
  itEffect('should provide environment', () =>
    Effect.gen(function* ($) {
      const configProvider = ConfigProvider.fromMap(
        new Map([
          ['JIRA_PAT', 'dummy-jira-pat'],
          ['JIRA_API_URL', 'https://dummy-jira-instance.com'],
          ['JIRA_KEY_PREFIX', 'DUMMYAPP'],
        ]),
      );

      const env = yield* $(
        Effect.provide(testProg, mkTestLayer(configProvider)),
      );

      expect(env).toEqual({
        defaultJiraKeyPrefix: Option.some('DUMMYAPP'),
        jiraApiUrl: 'https://dummy-jira-instance.com',
        jiraPat: 'dummy-jira-pat',
      });
    }),
  );

  itEffect('should provide environment with missing optional values', () =>
    Effect.gen(function* ($) {
      const configProvider = ConfigProvider.fromMap(
        new Map([
          ['JIRA_PAT', 'dummy-jira-pat'],
          ['JIRA_API_URL', 'https://dummy-jira-instance.com'],
        ]),
      );

      const env = yield* $(
        Effect.provide(testProg, mkTestLayer(configProvider)),
      );

      expect(env).toEqual({
        defaultJiraKeyPrefix: Option.none(),
        jiraApiUrl: 'https://dummy-jira-instance.com',
        jiraPat: 'dummy-jira-pat',
      });
    }),
  );

  itEffect('should report missing configuration values', () =>
    Effect.gen(function* ($) {
      const configProvider = ConfigProvider.fromMap(
        new Map([['JIRA_API_URL', 'https://dummy-jira-instance.com']]),
      );

      const result = yield* $(
        Effect.either(Effect.provide(testProg, mkTestLayer(configProvider))),
      );
      Either.match(result, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            AppConfigError({
              message: 'Expected JIRA_PAT to exist in the provided map',
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error'),
      });
    }),
  );

  itEffect('should report multiple missing configuration values', () =>
    Effect.gen(function* ($) {
      const configProvider = ConfigProvider.fromMap(new Map());

      const result = yield* $(
        Effect.either(Effect.provide(testProg, mkTestLayer(configProvider))),
      );

      Either.match(result, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            AppConfigError({
              message:
                'Expected JIRA_PAT to exist in the provided map\nExpected JIRA_API_URL to exist in the provided map',
            }),
          ),
        onRight: (_) => expect.unreachable('Should have returned an error'),
      });
    }),
  );
});
