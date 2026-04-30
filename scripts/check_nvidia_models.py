import urllib.request, json, os

# 从环境变量读取，不要硬编码在代码里
# 使用前请先设置：export NVIDIA_API_KEY="nvapi-..."
key = os.environ.get("NVIDIA_API_KEY", "")
if not key:
    raise RuntimeError("请设置环境变量 NVIDIA_API_KEY")
models = [
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-405b-instruct",
    "meta/llama-3.1-70b-instruct",
    "deepseek-ai/deepseek-v3.2",
    "deepseek-ai/deepseek-v4-flash",
    "qwen/qwen3.5-122b-a10b",
    "nvidia/llama-3.1-nemotron-70b-instruct",
    "nvidia/llama-3.3-nemotron-super-49b-v1",
    "mistralai/mixtral-8x22b-instruct-v0.1",
    "mistralai/mistral-large-2-instruct",
    "google/gemma-3-27b-it",
    "nv-mistralai/mistral-nemo-12b-instruct",
    "moonshotai/kimi-k2-instruct",
]

for m in models:
    body = json.dumps({"model": m, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 5}).encode()
    req = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    )
    try:
        r = urllib.request.urlopen(req, timeout=15)
        print(f"200  {m}")
    except urllib.error.HTTPError as e:
        print(f"{e.code}  {m}")
    except Exception as e:
        print(f"ERR  {m}  {e}")
