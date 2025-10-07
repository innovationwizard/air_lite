#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraCdkStack } from '../lib/infra_cdk-stack';

const app = new cdk.App();
new InfraCdkStack(app, 'InfraCdkStack', {
  env: { account: '200937443798', region: 'us-east-2' },
});