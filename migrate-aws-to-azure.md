# Migrate a Docker app from AWS EC2 to this Azure VM

Use this when an app already runs on EC2 with Docker Compose and Amazon Bedrock, and the same stack should run on the Azure VM that hosts SciNova. The worked example is SciNova OS. The steps apply to any similar repo: one Ubuntu VM, `docker compose`, a public IP, and an OpenAI-compatible chat API.

Do not copy AWS access keys onto the VM. Do not commit API keys.

## What stays the same

| Piece | Keep it |
|-------|---------|
| App | The same git repo and `docker compose` services |
| Shape | One VM. Frontend, API, and data stores in containers |
| Size | 2 vCPU and 8 GiB is the demo size. EC2 `t3.large` matches Azure `Standard_D2s_v3` |
| Ports | SciNova: SSH 22, UI 5173, API 8000. **SEAL:** SSH 22, UI **3000** (nginx proxies `/api` to the API container on 4000). Leave Postgres and Redis closed to the internet |
| Code updates | `git pull`, then restart only the containers that read the changed files |

### SEAL (this repo)

| Item | Value |
|------|--------|
| Repo | `https://github.com/saurabhdsh/seal-claude-mastery.git` |
| Setup | `bash scripts/setup_azure.sh` |
| LLM check | `bash scripts/test-llm.sh` |
| Cloud flag | `SEAL_CLOUD=azure` |
| Provider | `AI_PROVIDER=openai`, `BEDROCK_ENABLED=false` |
| Chat | `OPENAI_BASE_URL=…/openai/v1`, `OPENAI_MODEL=gpt-5-mini` |
| CORS / APP_URL | `http://20.127.186.132:3000` |
| NSG | Inbound TCP **3000** (not 5173/8000) |

## What must change

| On EC2 | On this Azure VM |
|--------|------------------|
| Amazon Bedrock through the instance role `WeaveEC2BedrockRole` | No AWS role. Chat goes to Azure OpenAI |
| `SCINOVA_CLOUD=aws`, `DEFAULT_LLM_PROVIDER=bedrock`, `BEDROCK_ENABLED=true` | `SCINOVA_CLOUD=azure`, `DEFAULT_LLM_PROVIDER=openai`, `BEDROCK_ENABLED=false` |
| Model id such as `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | The **deployment name** on the Azure resource. Here that name is `gpt-5-mini` |
| Security group on the instance | Network security group `rapid-build-dev-server-nsg` |
| Host `weave-server`, Elastic IP `52.0.130.62`, user `ec2-user` or `ubuntu` | Host `rapid-build-dev-server`, public IP `20.127.186.132`, user `azureuser` |
| `docker compose restart` after editing `.env` | Recreate the containers. A restart keeps the old environment |

A Linux host is not automatically EC2. If the code treats “not a Mac” as “use Bedrock”, an Azure VM will call Bedrock and fail. Gate that choice with an explicit cloud name.

## Azure target

| Item | Value |
|------|--------|
| Computer name | `rapid-build-dev-server` |
| Resource group | `RAPID-BUILD-DEV-SERVER_GROUP` |
| Subscription | `az-ai_st-pjpc-01nl166917` |
| Subscription ID | `eb2757c6-7b0f-409c-89a9-3d949470d9d0` |
| Location | East US, zone 1 |
| Size | `Standard_D2s_v3` (2 vCPU, 8 GiB) |
| Image | Ubuntu 24.04 LTS, x64, Generation 2 |
| Public IP | `20.127.186.132` |
| Private IP | `10.0.0.4` |
| Network | `rapid-build-dev-server-vnet` / `default` |
| NIC | `rapid-build-dev-server999_z1` |
| Network security group | `rapid-build-dev-server-nsg` |
| DNS name | Not configured. Use the public IP |
| Chat resource | `https://exxondemofdr.cognitiveservices.azure.com/` |
| Chat deployment | `gpt-5-mini` (served as `gpt-5-mini-2025-08-07`) |

8 GiB is tight once Postgres, Neo4j, Redis, and the app are all up. If the graph database is killed, resize the VM to `Standard_D4s_v3`.

## 1. Open the network

Inbound rules on `rapid-build-dev-server-nsg`. The last rule, priority 65500, denies everything else.

| Name | Port | Protocol | Action | Priority |
|------|------|----------|--------|----------|
| SSH | 22 | TCP | Allow | 300 (already present) |
| App UI (SciNova) | 5173 | TCP | Allow | 310 |
| App API (SciNova) | 8000 | TCP | Allow | 320 |
| App UI (SEAL) | 3000 | TCP | Allow | 330 |

Port 80 may already be open. SciNova does not listen on 80. SEAL publishes the UI on **3000** only (API stays on the Docker network). Do not add 5432, 7474, 7687, 6379, 4000, or 8001.

From a Mac:

```bash
az login
az account set --subscription "eb2757c6-7b0f-409c-89a9-3d949470d9d0"
az vm start \
  --resource-group "RAPID-BUILD-DEV-SERVER_GROUP" \
  --name "rapid-build-dev-server"
ssh azureuser@20.127.186.132
```

Use the admin name chosen when the VM was created if `azureuser` is rejected.

## 2. Put the app on the VM

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
```

For SciNova the repo is `https://github.com/saurabhdsh/scinova-os.git`. For SEAL it is `https://github.com/saurabhdsh/seal-claude-mastery.git`. Both use `bash scripts/setup_azure.sh`: install Docker, write an OpenAI `.env` when none exists, and `docker compose up -d --build`.

For another project, install Docker the same way and start that project's compose file. Run compose with `sudo` until a new SSH session picks up the `docker` group:

```bash
sudo docker compose up -d --build
```

`git pull main` is the wrong command. Use `git pull`.

## 3. Point chat at Azure OpenAI

The portal resource root is not the API base. Append `/openai/v1`.

```bash
OPENAI_API_KEY=paste-the-key-here
OPENAI_BASE_URL=https://exxondemofdr.cognitiveservices.azure.com/openai/v1
LLM_MODEL=gpt-5-mini
SCINOVA_CLOUD=azure
DEFAULT_LLM_PROVIDER=openai
BEDROCK_ENABLED=false
```

SEAL uses the same endpoint and deployment with SEAL-named keys:

```bash
OPENAI_API_KEY=paste-the-key-here
OPENAI_BASE_URL=https://exxondemofdr.cognitiveservices.azure.com/openai/v1
OPENAI_MODEL=gpt-5-mini
SEAL_CLOUD=azure
AI_PROVIDER=openai
BEDROCK_ENABLED=false
APP_URL=http://20.127.186.132:3000
```

`LLM_MODEL` / `OPENAI_MODEL` must be the deployment name, not a model id from the EC2 `.env`. `gpt-4o-mini` returned `DeploymentNotFound` on this resource. `gpt-5-mini` answered.

Prove the key and endpoint before running the app. Keep the script tiny and do not print the key:

```bash
KEY="paste-the-key-here"
ENDPOINT="https://exxondemofdr.cognitiveservices.azure.com/openai/v1"
MODEL="gpt-5-mini"

curl -sS "${ENDPOINT%/}/chat/completions" \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: PONG\"}]}"
echo
```

A working call returns `PONG`. SciNova's copy of this check is `scripts/test-llm.sh`.

Then make the running containers read the file. `docker compose restart` does **not** reload variables from `.env` that were present when the container was created. Recreate them:

```bash
sudo docker compose up -d
```

Confirm the process sees the model and a non-empty key, without printing the key:

```bash
sudo docker compose exec backend python -c "from app.config import settings; print(settings.llm_model); print(bool(settings.openai_api_key)); print(settings.openai_base_url)"
```

Expect `gpt-5-mini`, `True`, and the `/openai/v1` URL.

### Request shape for gpt-5

`gpt-5-mini` accepts a normal chat body: `model` and `messages`. It rejects a custom `temperature`. Some calls also reject `response_format`. If a short curl works and the product still falls back to “set the API key”, the key is present and the extra fields are the failure. Send `max_completion_tokens` instead of `temperature`, and retry once without `temperature` and `response_format` on HTTP 400.

Embeddings are a different deployment. A chat deployment named `gpt-5-mini` does not serve `text-embedding-3-small`. Point `EMBEDDING_MODEL` at an embedding deployment on the same resource, or search and upload indexing will fail while chat works.

A small-model route that still calls Mistral keeps using `MISTRAL_API_KEY`. That key is independent of the Azure chat key.

CORS must include the public origin, or the browser will load the UI and fail the API:

```bash
# SciNova
CORS_ORIGINS=http://20.127.186.132:5173,http://localhost:5173

# SEAL (single origin string — matches docker-compose APP_URL)
APP_URL=http://20.127.186.132:3000
```

## 4. Code checklist for Cursor

Search the repo before editing.

1. Bedrock client, IAM role, and `AWS_ACCESS_KEY_ID` used as the only LLM path. On Azure set the provider to OpenAI and leave Bedrock off.
2. `platform.system() != "Darwin"` used to mean “this is EC2”. Replace that with an explicit `aws` / `azure` setting.
3. Hard-coded model `gpt-4o-mini` or an Anthropic Bedrock id on the chat path. The Azure deployment name has to win.
4. Chat requests that always send `temperature` or `response_format`. Guard those for `gpt-5` and `o1` / `o3` style models.
5. Error text that says the API key is missing whenever a chat call returns empty. A 400 from the deployment is a different fault.
6. `.env.example` and setup scripts that write a Bedrock `.env` on every Linux host. Add an Azure branch that writes the OpenAI block above.
7. Security-group docs that open only port 22. Add 5173 and 8000 on the Azure NSG.
8. Hostnames and CORS still pointing at `52.0.130.62` or an `ec2-*.compute.amazonaws.com` name.

Do not invent a second database or a Kubernetes cluster for this move. The VM already runs the compose stack.

## 5. After the first boot

| Change | What to run |
|--------|-------------|
| `.env` key, endpoint, or model | `sudo docker compose up -d` |
| Python code, and the process has no reload | `sudo docker compose restart backend celery-worker` |
| Frontend only, and the source tree is mounted into the container | Refresh the browser. If the file is stale, `sudo docker compose restart frontend` |
| First clone, images not built | `sudo docker compose up -d --build` |

`docker compose restart` is enough for a code change that is volume-mounted. It is not enough for a new environment variable.

Stop compute charges when the demo is idle. The disk and the public IP can still bill:

```bash
az vm deallocate \
  --resource-group "RAPID-BUILD-DEV-SERVER_GROUP" \
  --name "rapid-build-dev-server"
```

Start it again with `az vm start`. Then SSH in and run `sudo docker compose up -d` if the stack does not return on its own.

## Cursor prompt

Paste this at the start of a migration chat in another repo:

```text
Migrate this app from AWS EC2 + Bedrock onto the existing Azure VM.
Follow docs/migrate-aws-to-azure.md in the SciNova OS repo.
Keep Docker Compose on one Ubuntu VM. Do not add Kubernetes.
Turn Bedrock off. Send chat to
https://exxondemofdr.cognitiveservices.azure.com/openai/v1
with deployment gpt-5-mini.
Do not put API keys in git. Recreate containers after .env changes.
Open inbound TCP 5173 and 8000 on rapid-build-dev-server-nsg (SciNova).
For SEAL open inbound TCP 3000 instead; leave 4000 closed.
Leave database ports closed.
```

