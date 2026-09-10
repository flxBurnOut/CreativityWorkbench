import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-directory.mjs';

test('failed resource shutdown preserves its fixture while still stopping other resources', async () => {
  const scope = await createTestDirectory(undefined, 'failed-cleanup');
  const marker = join(scope.directory, 'active-resource.txt');
  let otherStopped = false;
  try {
    await writeFile(marker, 'still in use');
    scope.defer(() => { otherStopped = true; });
    scope.defer(() => { throw Error('owned process did not exit'); });
    await assert.rejects(scope.dispose(), error => error instanceof AggregateError && error.message.includes(scope.directory));
    assert.equal(otherStopped, true);
    assert.equal(await readFile(marker, 'utf8'), 'still in use');
  } finally {
    // This test has no live process; remove only the file it created and then
    // its now-empty directory. Never recursively remove a retained fixture.
    await unlink(marker);
    await rmdir(scope.directory);
  }
});
