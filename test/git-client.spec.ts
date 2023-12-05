import {describe, expect, beforeEach, afterEach, vi} from 'vitest';
import {Effect, Layer, Stream, Sink, Either} from 'effect';

import * as Error from '@effect/platform/Error';
import * as CommandExecutor from '@effect/platform/CommandExecutor';

import {GitClient, GitClientLive} from '../src/git-client';
import {EffectMock, effectMock, itEffect} from './util';
import {GitExecError} from '../src/types';
import {TextEncoder} from 'util';
import {Command} from '@effect/platform';

const testProg = Effect.gen(function* ($) {
  const gitClient = yield* $(GitClient);
  yield* $(gitClient.createGitBranch('feat/dummy-branch', false));
});

const mkTestProcess = (
  exitCode: number,
  stdout?: string,
  stderr?: string,
): CommandExecutor.Process => {
  const encoder = new TextEncoder();
  return {
    [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
    pid: CommandExecutor.ProcessId(1),
    exitCode: Effect.succeed(CommandExecutor.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    stderr: stderr ? Stream.make(encoder.encode(stderr)) : Stream.empty,
    stdout: stdout ? Stream.make(encoder.encode(stdout)) : Stream.empty,
    stdin: Sink.drain,
    kill: () => Effect.unit,
  };
};

describe('GitClient', () => {
  let executorMock: EffectMock<
    [Command.Command],
    Error.SystemError | Error.BadArgument,
    CommandExecutor.Process
  >;
  let testExecutor: Layer.Layer<never, never, CommandExecutor.CommandExecutor>;
  let testLayer: Layer.Layer<never, never, GitClient>;
  beforeEach(() => {
    executorMock = effectMock();
    testExecutor = Layer.succeed(
      CommandExecutor.CommandExecutor,
      CommandExecutor.makeExecutor(executorMock),
    );

    testLayer = GitClientLive.pipe(Layer.provide(testExecutor));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  itEffect('createGitBranch should run appropriate git command', () =>
    Effect.gen(function* ($) {
      executorMock.mockSuccessValueOnce(mkTestProcess(0));

      yield* $(Effect.provide(testProg, testLayer));

      expect(executorMock).toHaveBeenCalledTimes(1);
      expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
        _tag: 'StandardCommand',
        args: ['checkout', '-b', 'feat/dummy-branch'],
        command: 'git',
      });
    }),
  );

  itEffect(
    'createGitBranch should run appropriate git command (with reset)',
    () =>
      Effect.gen(function* ($) {
        executorMock.mockSuccessValueOnce(mkTestProcess(0));

        yield* $(
          Effect.provide(
            Effect.gen(function* ($) {
              const gitClient = yield* $(GitClient);
              yield* $(gitClient.createGitBranch('feat/dummy-branch', true));
            }),
            testLayer,
          ),
        );

        expect(executorMock).toHaveBeenCalledTimes(1);
        expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
          _tag: 'StandardCommand',
          args: ['checkout', '-B', 'feat/dummy-branch'],
          command: 'git',
        });
      }),
  );

  itEffect(
    'createGitBranchFrom should run git command with given basebranch',
    () =>
      Effect.gen(function* ($) {
        executorMock.mockSuccessValueOnce(mkTestProcess(0));

        yield* $(
          Effect.provide(
            Effect.gen(function* ($) {
              const gitClient = yield* $(GitClient);
              yield* $(
                gitClient.createGitBranchFrom('master')(
                  'feat/dummy-branch',
                  false,
                ),
              );
            }),
            testLayer,
          ),
        );

        expect(executorMock).toHaveBeenCalledTimes(1);
        expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
          _tag: 'StandardCommand',
          args: ['checkout', '-b', 'feat/dummy-branch', 'master'],
          command: 'git',
        });
      }),
  );

  itEffect(
    'createGitBranchFrom should run appropriate git command (with reset)',
    () =>
      Effect.gen(function* ($) {
        executorMock.mockSuccessValueOnce(mkTestProcess(0));

        yield* $(
          Effect.provide(
            Effect.gen(function* ($) {
              const gitClient = yield* $(GitClient);
              yield* $(
                gitClient.createGitBranchFrom('master')(
                  'feat/dummy-branch',
                  true,
                ),
              );
            }),
            testLayer,
          ),
        );

        expect(executorMock).toHaveBeenCalledTimes(1);
        expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
          _tag: 'StandardCommand',
          args: ['checkout', '-B', 'feat/dummy-branch', 'master'],
          command: 'git',
        });
      }),
  );

  itEffect(
    'listBranch should run appropriate git command and parse output',
    () =>
      Effect.gen(function* ($) {
        const commandOutput = `  * 7-switch-to-existing-branches
  chore/enforce-conventional-commits
  develop
  feat/MYAPP-1235-add-some-feature
  fix/MYAPP-1234-errorhandling
  master
    `;
        executorMock.mockSuccessValueOnce(mkTestProcess(0, commandOutput));

        const result = yield* $(
          Effect.provide(
            Effect.flatMap(GitClient, (gc) => gc.listBranches()),
            testLayer,
          ),
        );

        expect(result).toMatchInlineSnapshot(`
          {
            "_id": "Chunk",
            "values": [
              "7-switch-to-existing-branches",
              "chore/enforce-conventional-commits",
              "develop",
              "feat/MYAPP-1235-add-some-feature",
              "fix/MYAPP-1234-errorhandling",
              "master",
            ],
          }
        `);

        expect(executorMock).toHaveBeenCalledTimes(1);
        expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
          _tag: 'StandardCommand',
          args: ['branch'],
          command: 'git',
        });
      }),
  );

  itEffect('switchBranch should run appropriate git command', () =>
    Effect.gen(function* ($) {
      executorMock.mockSuccessValueOnce(mkTestProcess(0));

      yield* $(
        Effect.provide(
          Effect.flatMap(GitClient, (gc) =>
            gc.switchBranch('feat/dummy-branch'),
          ),
          testLayer,
        ),
      );

      expect(executorMock).toHaveBeenCalledTimes(1);
      expect(executorMock.mock.calls[0]?.[0]).toMatchObject({
        _tag: 'StandardCommand',
        args: ['checkout', 'feat/dummy-branch'],
        command: 'git',
      });
    }),
  );

  itEffect('should handle git command not found errors', () =>
    Effect.gen(function* ($) {
      const errorMessage = 'fatal: Dummy git error';
      executorMock.mockSuccessValueOnce(
        mkTestProcess(128, undefined, errorMessage),
      );

      const res = yield* $(Effect.either(Effect.provide(testProg, testLayer)));

      Either.match(res, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            GitExecError({
              message: `Git command failed with: [${errorMessage}]`,
            }),
          ),
        onRight: () =>
          expect.unreachable('Should have returned a GitExecError'),
      });
    }),
  );

  itEffect('should handle git errors', () =>
    Effect.gen(function* ($) {
      executorMock.mockFailValue(
        Error.SystemError({
          message: 'git command not found',
          reason: 'NotFound',
        } as Error.SystemError),
      );

      const res = yield* $(Effect.either(Effect.provide(testProg, testLayer)));
      Either.match(res, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            GitExecError({
              message:
                "Failed executing `git` command because `git` was not found. Please install `git` and make sure it's on your `$PATH`.",
            }),
          ),
        onRight: () =>
          expect.unreachable('Should have returned a GitExecError'),
      });
    }),
  );

  itEffect('should handle BadArgument errors', () =>
    Effect.gen(function* ($) {
      executorMock.mockFailValue(
        Error.BadArgument({
          message: 'Dummy Message',
        } as Error.BadArgument),
      );

      const res = yield* $(Effect.either(Effect.provide(testProg, testLayer)));
      Either.match(res, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            GitExecError({
              message: 'Unexpected error during git execution: [Dummy Message]',
            }),
          ),
        onRight: () =>
          expect.unreachable('Should have returned a GitExecError'),
      });
    }),
  );

  itEffect('should handle command execution platform errors', () =>
    Effect.gen(function* ($) {
      executorMock.mockFailValue(
        Error.SystemError({
          message: 'Fail',
          reason: 'Unknown',
        } as Error.SystemError),
      );

      const res = yield* $(Effect.either(Effect.provide(testProg, testLayer)));
      Either.match(res, {
        onLeft: (e) =>
          expect(e).toMatchObject(
            GitExecError({
              message: 'Unexpected error during git execution: [Unknown Fail]',
            }),
          ),
        onRight: () =>
          expect.unreachable('Should have returned a GitExecError'),
      });
    }),
  );
});
