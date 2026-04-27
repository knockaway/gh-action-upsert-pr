'use strict';

const tap = require('tap');
const sinon = require('sinon');
const { main } = require('./index');

function buildContext(inputs, githubRest) {
  return {
    core: {
      getInput: sinon.stub().callsFake(x => inputs[x] || ''),
      setOutput: sinon.stub(),
      setFailed: sinon.stub(),
      info: sinon.stub(),
      warning: sinon.stub(),
      error: sinon.stub(),
    },
    githubRest,
    owner: 'knockaway',
    repo: 'gh-action-upsert-pr',
  };
}

tap.test('creates a PR when no existing PR is found', async t => {
  const ctx = buildContext(
    {
      create_pr_title: 'Test Create PR Title',
      pr_source_branch: 'TmpBranchAutomation',
      pr_destination_branch: 'master',
      github_token: '',
      create_pr_template_file: 'README.md',
    },
    {
      pulls: {
        list: sinon.stub().resolves({ data: [] }),
        create: sinon.stub().resolves({
          data: { number: 42, html_url: 'https://example/42', requested_reviewers: [] },
        }),
        listReviews: sinon.stub().resolves({ data: [] }),
        requestReviewers: sinon.stub().resolves({ data: {} }),
      },
    }
  );

  await main({ ctx });

  t.notOk(ctx.core.setFailed.called, 'setFailed not called');
  t.ok(ctx.githubRest.pulls.create.calledOnce, 'pulls.create called');
  const created = ctx.core.setOutput.getCalls().find(c => c.args[0] === 'pr_created');
  t.equal(created.args[1], 'true', 'pr_created output is "true"');
});

tap.test('skips body update when update_pr_body_template_vars is empty', async t => {
  const existingPr = {
    number: 7,
    title: 'Existing title',
    body: '<!-- FOO_START -->\nprevious value\n<!-- FOO_END -->',
    html_url: 'https://example/7',
    requested_reviewers: [],
  };
  const ctx = buildContext(
    {
      pr_source_branch: 'master',
      pr_destination_branch: 'production',
      github_token: '',
      create_pr_title: 'unused',
      update_pr_body_template_vars: '{}',
    },
    {
      pulls: {
        list: sinon.stub().resolves({ data: [existingPr] }),
        update: sinon.stub().resolves({ data: existingPr }),
        listReviews: sinon.stub().resolves({ data: [] }),
        requestReviewers: sinon.stub().resolves({ data: {} }),
      },
    }
  );

  await main({ ctx });

  t.notOk(ctx.core.setFailed.called, 'setFailed not called');
  t.notOk(ctx.githubRest.pulls.update.called, 'pulls.update is NOT called when no template vars provided');
});
