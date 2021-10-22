'use strict';

const fs = require('fs');
const actionsCore = require('@actions/core');
const actionsGithub = require('@actions/github');

module.exports = { main, createPr, updatePr };

if (require.main === module) {
  main().catch();
}

async function main({
  core = actionsCore,
  github = actionsGithub,
  owner = github.context.repo.owner,
  repo = github.context.repo.repo,
} = {}) {
  try {
    let prSourceBranch = core.getInput('pr_source_branch');
    if (!prSourceBranch) {
      throw new Error('pr_source_branch is required');
    }

    // the head of a PR can come from another user/org, in which caste the format is org:branch,
    // but if the org:branch format is not used we assume the branch is in the current org
    if (!prSourceBranch.includes(':')) {
      prSourceBranch = `${owner}:${prSourceBranch}`;
    }

    const prDestinationBranch = core.getInput('pr_destination_branch');
    if (!prDestinationBranch) {
      throw new Error('pr_destination_branch is required');
    }

    const octokit = github.getOctokit(core.getInput('github_token'));

    /** @type import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods */
    const githubRest = octokit.rest;

    const {
      data: [existingPr],
    } = await githubRest.pulls.list({
      owner,
      repo,
      base: prDestinationBranch,
      head: prSourceBranch,
    });

    if (existingPr) {
      await updatePr({ githubRest, owner, repo, existingPr, core });
    } else {
      await createPr({ githubRest, owner, repo, prSourceBranch, prDestinationBranch, core });
    }
  } catch (error) {
    console.error(error);
    core.setFailed(error.message);
    process.exit(1);
  }
}

/**
 * Creates a PR according to the configuration given to this Action.
 *
 * @param {import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods} githubRest
 * @param {string} owner
 * @param {string} repo
 * @param {string} prSourceBranch
 * @param {string} prDestinationBranch
 * @param core - Only used for test dependency injection
 */
async function createPr({ githubRest, owner, repo, prSourceBranch, prDestinationBranch, core = actionsCore }) {
  const title = core.getInput('create_pr_title');
  if (!title) {
    throw new Error('create_pr_title is required when creating a PR');
  }
  const draft = core.getInput('create_pr_draft') === 'true';

  let body = core.getInput('create_pr_body') || '';
  if (!body) {
    const templateFile = core.getInput('create_pr_template_file') || '.github/pull_request_template.md';
    try {
      body = fs.readFileSync(templateFile).toString();
    } catch (error) {
      // error when reading .github/pull_request_template.md is to be expected if
      // the repository doesn't use a base pull request template. Otherwise, bad
      // parameter value given for template_file
      if (templateFile !== '.github/pull_request_template.md') {
        console.error(error);
        throw Error(`Error reading the given create_pr_template_file ${templateFile}`);
      }
    }
  }

  const templateVars = JSON.parse(core.getInput('create_pr_body_template_vars') || '{}');
  body = buildBodyFromTemplate({ template: body, templateVars });

  const { data: prJustCreated } = await githubRest.pulls.create({
    owner,
    repo,
    base: prDestinationBranch,
    head: prSourceBranch,
    title,
    body,
    draft,
  });

  await addPrReviewers({
    githubRest,
    owner,
    repo,
    existingPr: prJustCreated,
    reviewersToAddCsv: core.getInput('create_pr_reviewers'),
  });

  core.setOutput('pr_created', 'true');
  core.setOutput('pr_url', prJustCreated.html_url);
  core.setOutput('pr_number', `${prJustCreated.number}`);
}

/**
 * Updates a PR according to the configuration given to this Action.
 *
 * @param {import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods} githubRest
 * @param {string} owner
 * @param {string} repo
 * @param {object} existingPr
 * @param core - Only used for test dependency injection
 */
async function updatePr({ githubRest, owner, repo, existingPr, core = actionsCore }) {
  const title = core.getInput('update_pr_title') || existingPr.title;
  let body = core.getInput('update_pr_body') || existingPr.body || '';
  const templateVars = JSON.parse(core.getInput('update_pr_body_template_vars') || '{}');
  body = buildBodyFromTemplate({ template: body, templateVars });

  if ((title && title !== existingPr.title) || body !== existingPr.body) {
    console.log(`Updating PR #${existingPr.number}.`);
    await githubRest.pulls.update({ owner, repo, pull_number: existingPr.number, title, body });
  } else {
    console.log(`PR #${existingPr.number} is already up-to-date.`);
  }

  await addPrReviewers({
    githubRest,
    owner,
    repo,
    existingPr,
    reviewersToAddCsv: core.getInput('update_pr_reviewers'),
  });

  core.setOutput('pr_created', 'false');
  core.setOutput('pr_url', existingPr.html_url);
  core.setOutput('pr_number', `${existingPr.number}`);
}

/**
 * Replaces markdown tags in the template with the value specified by the templateVars.
 *
 * @param {string} template
 * @param {object} templateVars
 * @returns {string}
 */
function buildBodyFromTemplate({ template, templateVars }) {
  let body = template;

  for (let [k, v] of Object.entries(templateVars)) {
    const START_TAG = `<!-- ${k}_START -->`;
    const END_TAG = `<!-- ${k}_END -->`;

    const startTagIndex = body.indexOf(START_TAG);
    const endTagIndex = body.indexOf(END_TAG);

    if (startTagIndex === -1) {
      console.warn(`Template did not include ${START_TAG}, no spot for the value given in template vars`);
      continue;
    }
    if (endTagIndex === -1) {
      console.warn(`Template did not include ${END_TAG}, no spot for the value given in template vars`);
      continue;
    }

    if (!v.startsWith(START_TAG)) {
      v = `${START_TAG}\n${v}`;
    }
    if (!v.endsWith(END_TAG)) {
      v = `${v}\n${END_TAG}`;
    }

    body = body.slice(0, startTagIndex) + v + body.slice(endTagIndex + END_TAG.length);
  }

  return body;
}

/**
 * Adds any reviewers listed in reviewersToAddCsv which are not already reviewers as reviewers of the PR.
 *
 * @param {import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods} githubRest
 * @param {string} owner
 * @param {string} repo
 * @param {object} existingPr
 * @param {string} reviewersToAddCsv
 */
async function addPrReviewers({ githubRest, owner, repo, existingPr, reviewersToAddCsv }) {
  const beforePrReviewers = new Set(existingPr.requested_reviewers.map(reviewer => reviewer.login));
  const afterPrReviewers = new Set([...beforePrReviewers]);

  if (reviewersToAddCsv) {
    for (const additionalReviewer of reviewersToAddCsv.split(',')) {
      afterPrReviewers.add(reviewersToAddCsv.trim());
    }
  }

  const newPrReviewers = [...afterPrReviewers].filter(login => !beforePrReviewers.has(login));

  if (newPrReviewers.length === 0) {
    console.log('No additional reviewers to add.');
    return;
  }

  console.log(`Adding reviewers to PR #${existingPr.number}: ${newPrReviewers.join(', ')}`);
  await githubRest.pulls.requestReviewers({ owner, repo, pull_number: existingPr.number, reviewers: newPrReviewers });
}
