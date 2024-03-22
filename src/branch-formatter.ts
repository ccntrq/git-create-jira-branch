import type {GitBranch} from './types';

import {Doc} from '@effect/printer';
import {green} from '@effect/printer-ansi/Ansi';
import {render} from '@effect/printer-ansi/AnsiDoc';
import {Chunk, pipe} from 'effect';

export const formatBranches = (branches: Chunk.Chunk<GitBranch>): string => {
  const hasCurrent = Chunk.some(branches, (_) => _.isCurrent);
  return pipe(
    branches,
    Chunk.map((branch) =>
      branch.isCurrent
        ? pipe(Doc.text('*'), Doc.catWithSpace(mkGreen(Doc.text(branch.name))))
        : Doc.indent(Doc.text(branch.name), hasCurrent ? 2 : 0),
    ),
    Doc.vcat,
    render({style: 'pretty'}),
  );
};

const mkGreen = Doc.annotate(green);
