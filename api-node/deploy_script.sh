#!/bin/bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="us-east-2"
AWS_ACCOUNT_ID="200937443798"
AWS_PROFILE="airefill-prod"
ECR_REPO_NAME="airefill-api"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
ECS_CLUSTER="airefill-api-cluster"
ECS_SERVICE="airefill-api"
IMAGE_TAG="${1:-latest}"

echo -e "${GREEN}=== AI Refill API Deployment ===${NC}\n"

# Check if AWS CLI is configured with the correct profile
if ! aws sts get-caller-identity --profile ${AWS_PROFILE} &>/dev/null; then
    echo -e "${RED}Error: AWS CLI not configured for profile '${AWS_PROFILE}'${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: ECR login...${NC}"
aws ecr get-login-password --region ${AWS_REGION} --profile ${AWS_PROFILE} | \
    docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

echo -e "\n${YELLOW}Step 2: Building and pushing Docker image (linux/amd64)...${NC}"
docker buildx build \
    --platform linux/amd64 \
    --no-cache \
    --provenance=false \
    --push \
    -t ${ECR_URI}:${IMAGE_TAG} \
    .

echo -e "\n${YELLOW}Step 3: Updating ECS service (force new deployment)...${NC}"
aws ecs update-service \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE} \
    --force-new-deployment \
    --region ${AWS_REGION} \
    --profile ${AWS_PROFILE} \
    --query 'service.{Status:status,Running:runningCount,Desired:desiredCount}' \
    --output table

echo -e "\n${YELLOW}Step 4: Waiting for service to stabilize...${NC}"
aws ecs wait services-stable \
    --cluster ${ECS_CLUSTER} \
    --services ${ECS_SERVICE} \
    --region ${AWS_REGION} \
    --profile ${AWS_PROFILE}

echo -e "\n${GREEN}Deployment complete!${NC}"
echo -e "Verify: curl -s https://api.airefill.app/api/v1/health | jq"
echo -e "Logs:   aws logs tail /ecs/airefill-api --follow --region ${AWS_REGION} --profile ${AWS_PROFILE}"
