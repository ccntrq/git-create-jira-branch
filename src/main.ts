#!/usr/bin/env node

import {Effect, Exit, Layer, Logger, Runtime, Scope, pipe} from 'effect';
import * as Http from '@effect/platform/HttpClient';
import * as NodeCommandExecutor from '@effect/platform-node/CommandExecutor';
import * as NodeFileSystem from '@effect/platform-node/FileSystem';

import {EnvironmentLive} from './environment';
import {GitClientLive} from './git-client';
import {JiraClientLive} from './jira-client';
import {cliEffect} from './cli';
import {NodeContext} from '@effect/platform-node';

const gitClientLayer = GitClientLive.pipe(
  Layer.provide(NodeCommandExecutor.layer),
  Layer.provide(NodeFileSystem.layer),
);

const jiraClientLayer = JiraClientLive.pipe(
  Layer.provide(Http.client.layer),
  Layer.provide(EnvironmentLive),
);

// Define a configuration layer
const loggerLayer = Logger.replace(
  Logger.defaultLogger,
  // eslint-disable-next-line no-console
  Logger.make(({message}) => console.log(message)),
);

const mainLive = Layer.mergeAll(
  gitClientLayer,
  EnvironmentLive,
  jiraClientLayer,
  loggerLayer,
  NodeContext.layer,
);

const mainEffect = pipe(
  Effect.sync(() => process.argv.slice(2)),
  Effect.flatMap(cliEffect),
);

const scope = Effect.runSync(Scope.make());

Effect.runPromise(Layer.toRuntime(mainLive).pipe(Scope.extend(scope))).then(
  (runtime) => {
    const runPromise = Runtime.runPromise(runtime);
    runPromise(mainEffect).then((_) =>
      Effect.runFork(Scope.close(scope, Exit.unit)),
    );
  },
);
