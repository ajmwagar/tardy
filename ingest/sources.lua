local sources = {}

local function add(source)
  sources[#sources + 1] = source
end

local function github(id, display_name, owner, repo)
  add({
    id = id, display_name = display_name, enabled = true, limit = 10,
    poll_interval_seconds = 900, poll_jitter_seconds = 600,
    transport = { kind = "github_releases", owner = owner, repo = repo },
    rights = { mode = "facts", attribution = display_name .. " on GitHub", commercial_use = true },
    transform = "release",
  })
end

local function hacker_news(list, display_name)
  add({
    id = "hacker-news-" .. list, display_name = display_name, enabled = true, limit = 20,
    poll_interval_seconds = 120, poll_jitter_seconds = 90,
    transport = { kind = "hacker_news", list = list },
    rights = { mode = "facts", attribution = "Hacker News", commercial_use = true },
    transform = "news_item",
  })
end

local function summary_prompt(item)
  return "Summarize this source item without adding facts. Preserve names and version numbers. " ..
    "Return two short sentences and cite the canonical URL.\n\nTitle: " .. item.title ..
    "\nURL: " .. item.canonical_url .. "\nSource summary: " .. (item.summary or "")
end

hacker_news("top", "Hacker News Top")
hacker_news("new", "Hacker News New")
hacker_news("best", "Hacker News Best")

add({
  id = "cloudflare-blog", display_name = "Cloudflare Blog", enabled = true, limit = 10,
  poll_interval_seconds = 600, poll_jitter_seconds = 300,
  transport = { kind = "rss", url = "https://blog.cloudflare.com/rss/" },
  rights = { mode = "index", attribution = "Cloudflare Blog", commercial_use = true },
  transform = "news_item",
})

github("openai-python-releases", "OpenAI Python", "openai", "openai-python")
github("openai-node-releases", "OpenAI Node", "openai", "openai-node")
github("transformers-releases", "Hugging Face Transformers", "huggingface", "transformers")
github("huggingface-hub-releases", "Hugging Face Hub", "huggingface", "huggingface_hub")
github("pytorch-releases", "PyTorch", "pytorch", "pytorch")
github("tensorflow-releases", "TensorFlow", "tensorflow", "tensorflow")
github("rust-releases", "Rust", "rust-lang", "rust")
github("tokio-releases", "Tokio", "tokio-rs", "tokio")
github("deno-releases", "Deno", "denoland", "deno")
github("bun-releases", "Bun", "oven-sh", "bun")
github("uv-releases", "uv", "astral-sh", "uv")
github("ruff-releases", "Ruff", "astral-sh", "ruff")
github("tailscale-releases", "Tailscale", "tailscale", "tailscale")
github("workers-sdk-releases", "Cloudflare Workers SDK", "cloudflare", "workers-sdk")
github("nextjs-releases", "Next.js", "vercel", "next.js")
github("react-releases", "React", "facebook", "react")
github("vue-releases", "Vue", "vuejs", "core")
github("svelte-releases", "Svelte", "sveltejs", "svelte")
github("kubernetes-releases", "Kubernetes", "kubernetes", "kubernetes")
github("docker-compose-releases", "Docker Compose", "docker", "compose")
github("podman-releases", "Podman", "containers", "podman")
github("neovim-releases", "Neovim", "neovim", "neovim")
github("helix-releases", "Helix", "helix-editor", "helix")
github("zed-releases", "Zed", "zed-industries", "zed")
github("go-releases", "Go", "golang", "go")
github("node-releases", "Node.js", "nodejs", "node")
github("cpython-releases", "Python", "python", "cpython")
github("nushell-releases", "Nushell", "nushell", "nushell")
github("ripgrep-releases", "ripgrep", "BurntSushi", "ripgrep")
github("fd-releases", "fd", "sharkdp", "fd")
github("fzf-releases", "fzf", "junegunn", "fzf")
github("starship-releases", "Starship", "starship", "starship")
github("alacritty-releases", "Alacritty", "alacritty", "alacritty")
github("wezterm-releases", "WezTerm", "wezterm", "wezterm")
github("lazygit-releases", "lazygit", "jesseduffield", "lazygit")
github("github-cli-releases", "GitHub CLI", "cli", "cli")
github("arrow-releases", "Apache Arrow", "apache", "arrow")
github("duckdb-releases", "DuckDB", "duckdb", "duckdb")
github("postgres-releases", "PostgreSQL", "postgres", "postgres")
github("redis-releases", "Redis", "redis", "redis")
github("ollama-releases", "Ollama", "ollama", "ollama")
github("llama-cpp-releases", "llama.cpp", "ggml-org", "llama.cpp")
github("vllm-releases", "vLLM", "vllm-project", "vllm")
github("exo-releases", "exo", "exo-explore", "exo")
github("mistral-inference-releases", "Mistral Inference", "mistralai", "mistral-inference")
github("ooda-releases", "FPL OODA", "FuturePresentLabs", "ooda")

-- Kept as an explicit licensing example, not one of the 50 active launch profiles.
add({
  id = "bbc-pidgin", display_name = "BBC News Pidgin", enabled = false, limit = 10,
  poll_interval_seconds = 900, poll_jitter_seconds = 600,
  transport = { kind = "rss", url = "https://feeds.bbci.co.uk/pidgin/rss.xml" },
  rights = { mode = "requires_license", attribution = "BBC News Pidgin", commercial_use = false },
  transform = "news_item",
})

local function enrichment_requests(item)
  return {
    {
      capability = "ooda_complete",
      instruction = "Draft attributed Tardy copy using only this normalized source item: " .. item.canonical_url,
      max_output_tokens = 220,
    },
    {
      capability = "rlcd_rank",
      instruction = "Score timeliness, novelty, and likely reader value without changing the source facts.",
      max_output_tokens = 64,
    },
  }
end

return {
  sources = sources,
  transforms = {
    news_item = function(item, rights)
      return {
        headline = item.title, attribution = rights.attribution, source_url = item.canonical_url,
        carousel = { format = "headline_source_v1", slides = { item.title, rights.attribution, item.canonical_url } },
        llm = { system = "You transform attributed source metadata into concise Tardy copy.", prompt = summary_prompt(item), max_output_tokens = 180 },
        capabilities = enrichment_requests(item),
      }
    end,
    release = function(item, rights)
      return {
        headline = item.title, attribution = rights.attribution, source_url = item.canonical_url,
        carousel = { format = "release_notes_v1", slides = { item.title, item.facts.tag or "release", item.canonical_url } },
        llm = { system = "You summarize software releases from supplied release notes only.", prompt = summary_prompt(item), max_output_tokens = 220 },
        capabilities = enrichment_requests(item),
      }
    end,
  },
}
