'use strict';

const tap = require('tap');
const sinon = require('sinon');
const { main } = require('./index');

tap.beforeEach(async t => {
  const inputs = {
    create_pr_title: 'Test Create PR Title',
    update_pr_title: 'Test Update PR Title',
    pr_source_branch: 'TmpBranchAutomation',
    update_pr_reviewers: '',
    pr_destination_branch: 'master',
    github_token: '',
  };
  t.context = {
    core: {
      getInput: sinon.stub().callsFake(x => inputs[x]),
      setOutput: sinon.stub(),
      setFailed: sinon.stub(),
      info: sinon.stub(),
      error: sinon.stub(),
    },
    owner: 'knockaway',
    repo: 'gh-action-upsert-pr',
  };
});

tap.test(async t => {
  await main({ ctx: t.context });
});
