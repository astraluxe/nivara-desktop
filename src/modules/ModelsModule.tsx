import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegistryModel {
  id: string;
  name: string;
  creator: string;
  params: string;
  quantization: string;
  size_gb: number;
  ram_min_gb: number;
  ram_recommended_gb: number;
  context_length: number;
  best_for: string[];
  license: string;
  gated: boolean;
  description: string;
  mesh_required?: boolean;
  cpu_only?: boolean;
  benchmark_mmlu?: number;
  benchmark_humaneval?: number;
  hf_repo?: string;
  hf_filename?: string;
}

interface InstalledModel {
  id: string;
  name: string;
  filename: string;
  size_gb: number;
  installed_at: string;
  last_used?: string;
  path: string;
}

interface GpuInfo {
  name: string;
  vram_gb: number;
}

interface SysInfo {
  total_ram_gb: number;
  available_ram_gb: number;
  cpu_count: number;
  os_name: string;
}

interface DownloadProgress {
  pct: number;
  downloaded_gb: number;
  total_gb: number;
}

interface PullResponse {
  gated: boolean;
  model_id: string;
  name: string;
  filename?: string;
  size_gb?: number;
  download_url?: string;
  token_url?: string;
  message?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Pull URL for when Vercel API routes are deployed (Phase 9).
// Downloads are deferred until then — catalogue browsing is fully static/local.
const PULL_URL = 'https://adris.tech/api/models/pull';

const FILTER_LABELS: Record<string, string> = {
  all:       'All',
  cpu:       'CPU · No GPU',
  coding:    'Coding',
  chat:      'Chat',
  reasoning: 'Reasoning',
  writing:   'Writing',
  indic:     'Indian langs',
  quick:     'Quick tasks',
};

// ─── Static model catalogue (no external API — 51 models, same as website) ───

const DESKTOP_MODELS: RegistryModel[] = [
  // Mesh frontier (448+ GB RAM)
  { id:'deepseek-r1-671b-q4', name:'DeepSeek R1 671B', creator:'DeepSeek', params:'671B MoE', quantization:'Q4_K_M', size_gb:404.0, ram_min_gb:448, ram_recommended_gb:512, context_length:131072, best_for:['reasoning'], benchmark_mmlu:93, license:'MIT', gated:false, description:'Full DeepSeek R1 — o1 level reasoning. Most powerful open model. Mesh only.', mesh_required:true },
  { id:'deepseek-v3-671b-q4', name:'DeepSeek V3', creator:'DeepSeek', params:'671B MoE', quantization:'Q4_K_M', size_gb:404.0, ram_min_gb:448, ram_recommended_gb:512, context_length:131072, best_for:['coding','reasoning','chat'], benchmark_mmlu:91, license:'DeepSeek', gated:false, description:'DeepSeek 671B MoE frontier. GPT-4 class coding. Runs only on Mesh.', mesh_required:true },
  { id:'llama31-405b-q4', name:'Llama 3.1 405B', creator:'Meta', params:'405B', quantization:'Q4_K_M', size_gb:244.0, ram_min_gb:256, ram_recommended_gb:320, context_length:131072, best_for:['chat','reasoning','writing','coding'], benchmark_mmlu:92, license:'Llama 3.1', gated:true, description:'Meta frontier model. GPT-4 tier quality. Requires Mesh across multiple machines.', mesh_required:true },
  { id:'deepseek-v2-236b-q4', name:'DeepSeek V2 236B', creator:'DeepSeek', params:'236B MoE', quantization:'Q4_K_M', size_gb:142.0, ram_min_gb:160, ram_recommended_gb:192, context_length:131072, best_for:['coding','reasoning'], benchmark_mmlu:84, license:'DeepSeek', gated:false, description:'Previous DeepSeek flagship MoE. Excellent at scale with Mesh.', mesh_required:true },
  { id:'mixtral-8x22b-q4', name:'Mixtral 8×22B', creator:'Mistral AI', params:'141B MoE', quantization:'Q4_K_M', size_gb:87.0, ram_min_gb:96, ram_recommended_gb:128, context_length:65536, best_for:['chat','coding','reasoning'], benchmark_mmlu:78, license:'Apache 2.0', gated:false, description:'8-expert MoE at 22B each. Fast inference for its size via Mesh.', mesh_required:true },
  { id:'mistral-large-123b-q4', name:'Mistral Large 123B', creator:'Mistral AI', params:'123B', quantization:'Q4_K_M', size_gb:74.0, ram_min_gb:80, ram_recommended_gb:96, context_length:131072, best_for:['chat','reasoning','writing','coding'], benchmark_mmlu:84, license:'Mistral', gated:false, description:'Mistral flagship 123B with 128K context. Needs Mesh or high-VRAM workstation.', mesh_required:true },
  // 48+ GB RAM
  { id:'deepseek-r1-70b-q4', name:'DeepSeek R1 70B', creator:'DeepSeek', params:'70B', quantization:'Q4_K_M', size_gb:43.0, ram_min_gb:48, ram_recommended_gb:64, context_length:131072, best_for:['reasoning','coding'], benchmark_mmlu:90, license:'MIT', gated:false, description:'Near o1 quality reasoning on maths, science, and complex analysis.' },
  { id:'qwen25-72b-q4', name:'Qwen 2.5 72B', creator:'Alibaba', params:'72B', quantization:'Q4_K_M', size_gb:44.0, ram_min_gb:48, ram_recommended_gb:64, context_length:131072, best_for:['coding','reasoning','chat'], benchmark_mmlu:86, license:'Apache 2.0', gated:false, description:'Outperforms Llama 3.3 70B on coding and maths. 48 GB+ or Mesh.' },
  { id:'llama33-70b-q4', name:'Llama 3.3 70B', creator:'Meta', params:'70B', quantization:'Q4_K_M', size_gb:43.0, ram_min_gb:48, ram_recommended_gb:64, context_length:131072, best_for:['chat','reasoning','writing','coding'], benchmark_mmlu:88, license:'Llama 3.3', gated:true, description:'Meta flagship. Competes directly with GPT-4. Needs 48 GB+ RAM or Mesh.' },
  // 32 GB RAM
  { id:'falcon-40b-q4', name:'Falcon 40B', creator:'TII', params:'40B', quantization:'Q4_K_M', size_gb:24.0, ram_min_gb:32, ram_recommended_gb:40, context_length:2048, best_for:['chat'], license:'Apache 2.0', gated:false, description:'TII open-source 40B. Highly permissive Apache 2.0 licence for commercial use.' },
  { id:'mixtral-8x7b-q4', name:'Mixtral 8×7B', creator:'Mistral AI', params:'47B MoE', quantization:'Q4_K_M', size_gb:26.0, ram_min_gb:32, ram_recommended_gb:40, context_length:32768, best_for:['chat','coding','reasoning'], benchmark_mmlu:70, license:'Apache 2.0', gated:false, description:'8-expert MoE (7B each). Fast for its effective parameter count.' },
  // 24 GB RAM
  { id:'qwen25-coder-32b-q4', name:'Qwen 2.5 Coder 32B', creator:'Alibaba', params:'32B', quantization:'Q4_K_M', size_gb:19.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['coding'], benchmark_humaneval:92, license:'Apache 2.0', gated:false, description:'Best open code model at 32B — beats GPT-4 on several coding benchmarks.' },
  { id:'deepseek-r1-32b-q4', name:'DeepSeek R1 32B', creator:'DeepSeek', params:'32B', quantization:'Q4_K_M', size_gb:19.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['reasoning','coding'], benchmark_mmlu:83, license:'MIT', gated:false, description:'R1 reasoning at 32B. Excellent for complex maths and multi-step problems.' },
  { id:'qwq-32b-q4', name:'QwQ 32B', creator:'Alibaba', params:'32B', quantization:'Q4_K_M', size_gb:19.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['reasoning','coding'], benchmark_mmlu:85, license:'Apache 2.0', gated:false, description:'Alibaba reasoning model. Competitive with o1-mini on MATH and code benchmarks.' },
  { id:'qwen25-32b-q4', name:'Qwen 2.5 32B', creator:'Alibaba', params:'32B', quantization:'Q4_K_M', size_gb:19.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['coding','chat','reasoning'], benchmark_mmlu:83, license:'Apache 2.0', gated:false, description:'Top-tier coding and reasoning, near 70B quality at half the size.' },
  { id:'codellama-34b-q4', name:'Code Llama 34B', creator:'Meta', params:'34B', quantization:'Q4_K_M', size_gb:20.0, ram_min_gb:24, ram_recommended_gb:28, context_length:16384, best_for:['coding'], benchmark_humaneval:53, license:'Llama 2', gated:false, description:'Meta code specialised 34B. Fill-in-middle completion across many languages.' },
  { id:'command-r-35b-q4', name:'Command R 35B', creator:'Cohere', params:'35B', quantization:'Q4_K_M', size_gb:20.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['chat','writing','reasoning'], license:'CC-BY-NC', gated:false, description:'Cohere flagship with RAG and tool-use capabilities. 128K context.' },
  { id:'aya-expanse-32b-q4', name:'Aya Expanse 32B', creator:'Cohere', params:'32B', quantization:'Q4_K_M', size_gb:19.0, ram_min_gb:24, ram_recommended_gb:28, context_length:131072, best_for:['chat','writing','indic'], license:'CC-BY-NC', gated:false, description:'Multilingual model covering 23 languages including Hindi, Arabic, Turkish.' },
  { id:'yi15-34b-q4', name:'Yi 1.5 34B', creator:'01.AI', params:'34B', quantization:'Q4_K_M', size_gb:19.5, ram_min_gb:24, ram_recommended_gb:28, context_length:4096, best_for:['chat','reasoning'], benchmark_mmlu:77, license:'Apache 2.0', gated:false, description:'Strong multilingual 34B from 01.AI. Competes with much larger models on reasoning.' },
  // 16–20 GB RAM
  { id:'gemma3-27b-q4', name:'Gemma 3 27B', creator:'Google', params:'27B', quantization:'Q4_K_M', size_gb:16.0, ram_min_gb:20, ram_recommended_gb:24, context_length:131072, best_for:['chat','reasoning','indic'], benchmark_mmlu:83, license:'Gemma', gated:true, description:'Google powerful Gemma 3. Best Indian language support among open models.' },
  { id:'internlm25-20b-q4', name:'InternLM 2.5 20B', creator:'Shanghai AI Lab', params:'20B', quantization:'Q4_K_M', size_gb:12.0, ram_min_gb:16, ram_recommended_gb:18, context_length:1000000, best_for:['reasoning','coding','chat'], benchmark_mmlu:79, license:'InternLM', gated:false, description:'1 million token context window. Exceptional for long document analysis.' },
  { id:'codestral-22b-q4', name:'Codestral 22B', creator:'Mistral AI', params:'22B', quantization:'Q4_K_M', size_gb:12.5, ram_min_gb:16, ram_recommended_gb:20, context_length:32768, best_for:['coding'], benchmark_humaneval:91, license:'MNPL', gated:false, description:'Mistral dedicated code model. Best-in-class completion across 80+ languages.' },
  { id:'phi4-22b-q4', name:'Phi-4 22B', creator:'Microsoft', params:'22B', quantization:'Q4_K_M', size_gb:13.5, ram_min_gb:16, ram_recommended_gb:20, context_length:16384, best_for:['reasoning','coding','chat'], benchmark_mmlu:87, license:'MIT', gated:false, description:'Near-GPT-4 reasoning at 22B. Outperforms many 70B models.' },
  { id:'mistral-small-24b-q4', name:'Mistral Small 24B', creator:'Mistral AI', params:'24B', quantization:'Q4_K_M', size_gb:14.0, ram_min_gb:16, ram_recommended_gb:20, context_length:131072, best_for:['chat','coding','writing'], license:'Apache 2.0', gated:false, description:'Production-grade 24B with 128K context. Great all-rounder for teams.' },
  // 10–14 GB RAM
  { id:'phi4-14b-q4', name:'Phi-4 14B', creator:'Microsoft', params:'14B', quantization:'Q4_K_M', size_gb:8.5, ram_min_gb:12, ram_recommended_gb:16, context_length:16384, best_for:['reasoning','coding','chat'], benchmark_mmlu:84, license:'MIT', gated:false, description:'Competes with 70B models on reasoning. Fits in 12 GB RAM.' },
  { id:'qwen25-14b-q4', name:'Qwen 2.5 14B', creator:'Alibaba', params:'14B', quantization:'Q4_K_M', size_gb:8.5, ram_min_gb:12, ram_recommended_gb:16, context_length:131072, best_for:['coding','chat','reasoning'], benchmark_mmlu:79, license:'Apache 2.0', gated:false, description:'Strong all-round 14B with 128K context. Best at coding and multilingual tasks.' },
  { id:'deepseek-r1-14b-q4', name:'DeepSeek R1 14B', creator:'DeepSeek', params:'14B', quantization:'Q4_K_M', size_gb:8.5, ram_min_gb:12, ram_recommended_gb:14, context_length:131072, best_for:['reasoning','coding'], benchmark_mmlu:78, license:'MIT', gated:false, description:'Larger R1 distillation. Better reasoning than 7B, still fits in 12 GB RAM.' },
  { id:'deepseek-coder-v2-16b-q4', name:'DeepSeek Coder V2 16B', creator:'DeepSeek', params:'16B', quantization:'Q4_K_M', size_gb:9.4, ram_min_gb:12, ram_recommended_gb:16, context_length:131072, best_for:['coding'], benchmark_humaneval:90, license:'DeepSeek', gated:false, description:'MoE architecture — 16B active but near 30B+ quality on code.' },
  { id:'starcoder2-15b-q4', name:'StarCoder2 15B', creator:'BigCode', params:'15B', quantization:'Q4_K_M', size_gb:9.0, ram_min_gb:12, ram_recommended_gb:14, context_length:16384, best_for:['coding'], license:'BigCode RAIL', gated:false, description:'600+ programming languages. State of the art fill-in-middle code completion.' },
  { id:'gemma3-12b-q4', name:'Gemma 3 12B', creator:'Google', params:'12B', quantization:'Q4_K_M', size_gb:7.5, ram_min_gb:10, ram_recommended_gb:12, context_length:131072, best_for:['chat','reasoning','indic'], benchmark_mmlu:76, license:'Gemma', gated:true, description:'Google mid-size Gemma 3. Excellent Indian language support.' },
  { id:'llama32-11b-vision-q4', name:'Llama 3.2 11B Vision', creator:'Meta', params:'11B', quantization:'Q4_K_M', size_gb:7.0, ram_min_gb:10, ram_recommended_gb:12, context_length:131072, best_for:['chat','reasoning'], license:'Llama 3.2', gated:true, description:'Meta multimodal model — understands images alongside text.' },
  { id:'mistral-nemo-12b-q4', name:'Mistral Nemo 12B', creator:'Mistral AI', params:'12B', quantization:'Q4_K_M', size_gb:7.2, ram_min_gb:10, ram_recommended_gb:12, context_length:131072, best_for:['coding','writing','chat'], license:'Apache 2.0', gated:false, description:'Mistral + NVIDIA collaboration. 128K context, strong coding and reasoning.' },
  // 6–10 GB RAM
  { id:'gemma3-9b-q4', name:'Gemma 3 9B', creator:'Google', params:'9B', quantization:'Q4_K_M', size_gb:5.7, ram_min_gb:8, ram_recommended_gb:10, context_length:131072, best_for:['chat','writing','indic'], benchmark_mmlu:72, license:'Gemma', gated:true, description:'Google compact mid-size. Excellent multilingual instruction following.' },
  { id:'gemma2-9b-q4', name:'Gemma 2 9B', creator:'Google', params:'9B', quantization:'Q4_K_M', size_gb:5.7, ram_min_gb:8, ram_recommended_gb:10, context_length:8192, best_for:['chat','reasoning'], benchmark_mmlu:71, license:'Gemma', gated:true, description:'Previous Gemma 2 generation. Solid for chat and reasoning tasks.' },
  { id:'solar-10b-q4', name:'SOLAR 10.7B', creator:'Upstage', params:'10.7B', quantization:'Q4_K_M', size_gb:6.5, ram_min_gb:8, ram_recommended_gb:10, context_length:4096, best_for:['chat','reasoning'], license:'Apache 2.0', gated:false, description:'Outperforms Llama 2 70B despite being 10B, using depth upscaling.' },
  { id:'deepseek-r1-7b-q4', name:'DeepSeek R1 7B', creator:'DeepSeek', params:'7B', quantization:'Q4_K_M', size_gb:4.5, ram_min_gb:6, ram_recommended_gb:8, context_length:32768, best_for:['reasoning'], benchmark_mmlu:67, license:'MIT', gated:false, cpu_only:true, description:'Strong chain-of-thought reasoning at 7B. Best for maths, logic, analysis.' },
  { id:'qwen25-coder-7b-q4', name:'Qwen 2.5 Coder 7B', creator:'Alibaba', params:'7B', quantization:'Q4_K_M', size_gb:4.3, ram_min_gb:6, ram_recommended_gb:8, context_length:131072, best_for:['coding'], benchmark_humaneval:88, license:'Apache 2.0', gated:false, cpu_only:true, description:'Top coder at 7B — beats models 2× its size. 128K context.' },
  { id:'mistral-7b-q4', name:'Mistral 7B', creator:'Mistral AI', params:'7B', quantization:'Q4_K_M', size_gb:4.4, ram_min_gb:6, ram_recommended_gb:8, context_length:32768, best_for:['chat','writing','coding'], benchmark_mmlu:62, license:'Apache 2.0', gated:false, cpu_only:true, description:'Best quality-to-size at 7B. Great all-rounder for writing and chat.' },
  { id:'sarvam1-7b-q4', name:'Sarvam-1 7B', creator:'Sarvam AI', params:'7.3B', quantization:'Q4_K_M', size_gb:4.6, ram_min_gb:6, ram_recommended_gb:8, context_length:4096, best_for:['chat','indic'], license:'Apache 2.0', gated:false, description:'India-first model. Best Indic support — Hindi, Tamil, Telugu, Kannada, Bengali and more.' },
  { id:'llama31-8b-q4', name:'Llama 3.1 8B', creator:'Meta', params:'8B', quantization:'Q4_K_M', size_gb:4.9, ram_min_gb:6, ram_recommended_gb:8, context_length:131072, best_for:['chat','writing','reasoning'], benchmark_mmlu:73, license:'Llama 3.1', gated:true, cpu_only:true, description:'Meta flagship small model. 128K context, 8-language support.' },
  { id:'deepseek-coder-6b-q4', name:'DeepSeek Coder 6.7B', creator:'DeepSeek', params:'6.7B', quantization:'Q4_K_M', size_gb:3.9, ram_min_gb:6, ram_recommended_gb:8, context_length:16384, best_for:['coding'], benchmark_humaneval:74, license:'DeepSeek', gated:false, cpu_only:true, description:'Code-specialised. Excellent Python, JavaScript, TypeScript generation.' },
  // 2–6 GB RAM
  { id:'gemma3-4b-q4', name:'Gemma 3 4B', creator:'Google', params:'4B', quantization:'Q4_K_M', size_gb:3.0, ram_min_gb:4, ram_recommended_gb:6, context_length:131072, best_for:['chat','reasoning','indic'], benchmark_mmlu:72, license:'Gemma', gated:true, cpu_only:true, description:'Google compact model. Strong multilingual and reasoning per GB of RAM.' },
  { id:'phi4-mini-q4', name:'Phi-4 Mini', creator:'Microsoft', params:'3.8B', quantization:'Q4_K_M', size_gb:2.4, ram_min_gb:4, ram_recommended_gb:6, context_length:128000, best_for:['chat','reasoning','indic'], benchmark_mmlu:69, license:'MIT', gated:false, cpu_only:true, description:'Runs on 4 GB RAM, no GPU needed. Surprisingly capable. Best pick for office laptops.' },
  { id:'phi35-mini-q4', name:'Phi-3.5 Mini', creator:'Microsoft', params:'3.8B', quantization:'Q4_K_M', size_gb:2.4, ram_min_gb:4, ram_recommended_gb:4, context_length:131072, best_for:['chat','reasoning'], benchmark_mmlu:69, license:'MIT', gated:false, cpu_only:true, description:'128K context at 3.8B. No GPU needed. Ideal for CPU-only office laptops.' },
  { id:'llama32-3b-q4', name:'Llama 3.2 3B', creator:'Meta', params:'3B', quantization:'Q4_K_M', size_gb:2.0, ram_min_gb:4, ram_recommended_gb:4, context_length:131072, best_for:['chat','quick'], license:'Llama 3.2', gated:true, cpu_only:true, description:'Meta small instruction model. Runs on 4 GB RAM. Fast on CPU.' },
  { id:'qwen25-3b-q4', name:'Qwen 2.5 3B', creator:'Alibaba', params:'3B', quantization:'Q4_K_M', size_gb:2.0, ram_min_gb:4, ram_recommended_gb:4, context_length:32768, best_for:['coding','chat'], license:'Apache 2.0', gated:false, cpu_only:true, description:'Solid coding model for CPU-only devices. 4 GB RAM minimum.' },
  { id:'gemma2-2b-q4', name:'Gemma 2 2B', creator:'Google', params:'2B', quantization:'Q4_K_M', size_gb:1.5, ram_min_gb:2, ram_recommended_gb:3, context_length:8192, best_for:['quick','chat'], license:'Gemma', gated:true, cpu_only:true, description:'Tiny but capable. Runs on 2 GB RAM. Good for simple tasks on any laptop.' },
  { id:'qwen25-1b-q4', name:'Qwen 2.5 1.5B', creator:'Alibaba', params:'1.5B', quantization:'Q4_K_M', size_gb:1.0, ram_min_gb:2, ram_recommended_gb:2, context_length:32768, best_for:['quick'], license:'Apache 2.0', gated:false, cpu_only:true, description:'Runs on 2 GB RAM. Emails, summaries, quick replies — no GPU at all.' },
  { id:'smollm2-1b-q4', name:'SmolLM2 1.7B', creator:'HuggingFace', params:'1.7B', quantization:'Q4_K_M', size_gb:1.1, ram_min_gb:2, ram_recommended_gb:2, context_length:8192, best_for:['quick'], license:'Apache 2.0', gated:false, cpu_only:true, description:'Built for on-device use. 1.1 GB file, no GPU, works on any machine.' },
  { id:'llama32-1b-q4', name:'Llama 3.2 1B', creator:'Meta', params:'1B', quantization:'Q4_K_M', size_gb:0.8, ram_min_gb:2, ram_recommended_gb:2, context_length:131072, best_for:['quick'], license:'Llama 3.2', gated:true, cpu_only:true, description:'Meta ultra-tiny. 128K context window. Runs on any device with 2 GB RAM.' },
  { id:'tinyllama-1b-q4', name:'TinyLlama 1.1B', creator:'TinyLlama', params:'1.1B', quantization:'Q4_K_M', size_gb:0.7, ram_min_gb:2, ram_recommended_gb:2, context_length:2048, best_for:['quick','chat'], license:'Apache 2.0', gated:false, cpu_only:true, description:'Smallest model in the hub. 700 MB. Works on any laptop, any OS, no GPU.' },
];

const CONTEXT_LABELS = (ctx: number) => {
  if (ctx >= 100000) return '128K ctx';
  if (ctx >= 30000)  return '32K ctx';
  if (ctx >= 15000)  return '16K ctx';
  return `${Math.round(ctx / 1000)}K ctx`;
};

// ─── LoRA catalogue ───────────────────────────────────────────────────────────

interface LoraModel {
  id: string;
  name: string;
  description: string;
  base_model: string;
  base_model_id: string;
  tags: string[];
  size_mb: number;
  price_inr: number;
  license: string;
}

const LORA_DATA: LoraModel[] = [
  { id: 'hindi-instructor', name: 'Hindi Instructor', description: 'Makes any base model respond fluently in Hindi with natural instruction following. Tuned on 50K Hindi instruction pairs.', base_model: 'Llama 3.1 8B', base_model_id: 'llama31-8b-q4', tags: ['indic', 'chat'], size_mb: 120, price_inr: 0, license: 'Apache 2.0' },
  { id: 'indic-multilingual', name: 'Indic Multilingual', description: 'Hindi, Tamil, Telugu, Bengali, Kannada — all in one adapter. Best results with larger base models.', base_model: 'Mistral 7B', base_model_id: 'mistral-7b-q4', tags: ['indic', 'chat', 'writing'], size_mb: 180, price_inr: 149, license: 'CC-BY-NC' },
  { id: 'python-expert', name: 'Python Expert', description: 'Pushes coding models into Python-first mode. Stronger type hints, docstrings, and idiomatic patterns.', base_model: 'Qwen 2.5 Coder 7B', base_model_id: 'qwen25-coder-7b-q4', tags: ['coding'], size_mb: 95, price_inr: 0, license: 'Apache 2.0' },
  { id: 'code-reviewer', name: 'Code Reviewer', description: 'Transforms the base model into a code review specialist. Catches bugs, suggests refactors, explains issues clearly.', base_model: 'DeepSeek Coder 6.7B', base_model_id: 'deepseek-coder-6b-q4', tags: ['coding'], size_mb: 88, price_inr: 0, license: 'Apache 2.0' },
  { id: 'customer-support', name: 'Customer Support', description: 'Tuned to handle support tickets calmly and precisely. Works well with your company FAQ pasted as context.', base_model: 'Llama 3.2 3B', base_model_id: 'llama32-3b-q4', tags: ['chat', 'quick'], size_mb: 65, price_inr: 0, license: 'Apache 2.0' },
  { id: 'medical-qa', name: 'Medical QA', description: 'Clinical Q&A style tuned on medical literature. Use only as decision support — not a substitute for professional advice.', base_model: 'Mistral 7B', base_model_id: 'mistral-7b-q4', tags: ['reasoning', 'chat'], size_mb: 140, price_inr: 199, license: 'Research only' },
  { id: 'legal-drafting', name: 'Legal Drafting (India)', description: 'Drafts Indian legal documents — petitions, agreements, notices — in formal language aligned with Indian legal style.', base_model: 'Mistral 7B', base_model_id: 'mistral-7b-q4', tags: ['writing', 'reasoning'], size_mb: 155, price_inr: 299, license: 'Commercial' },
  { id: 'tamil-support', name: 'Tamil Instructor', description: 'Instruction following and conversational Tamil. Tuned on high-quality Tamil dialogue and task data.', base_model: 'Gemma 3 4B', base_model_id: 'gemma3-4b-q4', tags: ['indic', 'chat'], size_mb: 72, price_inr: 0, license: 'Gemma' },
];

// ─── Compare types ────────────────────────────────────────────────────────────

interface CompareSlot {
  model: InstalledModel;
  output: string;
  time_ms: number;
  token_count: number;
  done: boolean;
  error?: string;
}

// ─── Compare tab ─────────────────────────────────────────────────────────────

function CompareTab({ installed, sysRam, ollamaOk }: {
  installed: InstalledModel[];
  sysRam: number;
  ollamaOk: boolean | null;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState<CompareSlot[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const selectedModels = installed.filter(m => selected.includes(m.id));
  const totalRamNeeded = selectedModels.reduce((s, m) => s + m.size_gb * 1.2, 0); // ~1.2× file size for RAM
  const canRunTogether = sysRam > 0 && totalRamNeeded <= sysRam;
  const runMode: 'together' | 'sequential' | 'unknown' =
    selected.length < 2 ? 'unknown' : canRunTogether ? 'together' : 'sequential';

  function toggleModel(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  }

  async function streamModel(model: InstalledModel, promptText: string, signal: AbortSignal): Promise<void> {
    const start = Date.now();
    let tokenCount = 0;

    setResults(prev => prev.map(r =>
      r.model.id === model.id ? { ...r, output: '', done: false, error: undefined } : r
    ));

    try {
      const resp = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.path, prompt: promptText, stream: true }),
        signal,
      });

      if (!resp.ok || !resp.body) throw new Error(`Ollama returned ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            if (j.response) {
              tokenCount++;
              setResults(prev => prev.map(r =>
                r.model.id === model.id ? { ...r, output: r.output + j.response } : r
              ));
            }
            if (j.done) {
              setResults(prev => prev.map(r =>
                r.model.id === model.id
                  ? { ...r, done: true, time_ms: Date.now() - start, token_count: tokenCount }
                  : r
              ));
            }
          } catch { /* partial line */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setResults(prev => prev.map(r =>
        r.model.id === model.id
          ? { ...r, done: true, error: msg, time_ms: Date.now() - start }
          : r
      ));
    }
  }

  async function handleCompare() {
    if (!prompt.trim() || selectedModels.length < 2) return;
    setRunning(true);

    const slots: CompareSlot[] = selectedModels.map(m => ({
      model: m, output: '', time_ms: 0, token_count: 0, done: false,
    }));
    setResults(slots);

    const controller = new AbortController();
    abortRef.current = () => controller.abort();

    if (runMode === 'together') {
      await Promise.all(selectedModels.map(m => streamModel(m, prompt, controller.signal)));
    } else {
      for (const m of selectedModels) {
        if (controller.signal.aborted) break;
        await streamModel(m, prompt, controller.signal);
      }
    }

    setRunning(false);
    abortRef.current = null;
  }

  function handleStop() {
    abortRef.current?.();
    setRunning(false);
  }

  if (installed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-5">
        <p className="text-nv-text text-[13px] font-semibold">No models installed</p>
        <p className="text-nv-faint text-[11px]">Go to Model Hub, download at least 2 models, then compare them here.</p>
      </div>
    );
  }

  if (installed.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-5">
        <p className="text-nv-text text-[13px] font-semibold">Need at least 2 models</p>
        <p className="text-nv-faint text-[11px]">You have {installed.length} model installed. Download one more to start comparing.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative z-10">
      {/* Top controls */}
      <div className="shrink-0 border-b border-nv-border bg-nv-surface/50 p-4 flex flex-col gap-3">
        {/* Model selector */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] text-nv-faint font-mono uppercase">Select models to compare (2–4)</p>
          <div className="flex flex-wrap gap-2">
            {installed.map(m => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggleModel(m.id)}
                  className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-lg border transition-fast font-mono ${
                    on
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-nv-border text-nv-faint hover:border-nv-faint'
                  }`}
                >
                  {on && <span className="text-[8px]">✓</span>}
                  {m.name}
                  <span className="text-[8px] opacity-60">{m.size_gb}GB</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* RAM indicator */}
        {selected.length >= 2 && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-mono ${
            runMode === 'together'
              ? 'bg-emerald-500/8 border border-emerald-500/20 text-emerald-400'
              : 'bg-amber-500/8 border border-amber-500/20 text-amber-400'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
            {runMode === 'together'
              ? `Your RAM fits all ${selected.length} models simultaneously — will run in parallel`
              : `RAM needed (~${totalRamNeeded.toFixed(0)} GB) exceeds available (${sysRam.toFixed(0)} GB) — will run one by one`
            }
          </div>
        )}

        {/* Prompt */}
        <div className="flex gap-2">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCompare(); }}
            placeholder="Type your prompt here… (Ctrl+Enter to compare)"
            rows={2}
            className="flex-1 text-[12px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text placeholder:text-nv-faint resize-none"
          />
          {running ? (
            <button
              onClick={handleStop}
              className="px-4 py-2 rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 text-[11px] transition-fast shrink-0"
            >Stop</button>
          ) : (
            <button
              disabled={selected.length < 2 || !prompt.trim() || !ollamaOk}
              onClick={handleCompare}
              title={!ollamaOk ? 'Ollama is not running' : selected.length < 2 ? 'Select at least 2 models' : ''}
              className="px-4 py-2 rounded-lg bg-accent text-white text-[11px] font-medium hover:bg-accent-dim transition-fast disabled:opacity-40 shrink-0"
            >
              {runMode === 'together' ? '▶ Run together' : runMode === 'sequential' ? '▶ Run one by one' : '▶ Compare'}
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="flex-1 overflow-hidden flex gap-0 divide-x divide-nv-border">
          {results.map(slot => (
            <div key={slot.model.id} className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Column header */}
              <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-nv-border bg-nv-surface/30">
                <div className="min-w-0">
                  <p className="text-nv-text text-[11px] font-semibold truncate">{slot.model.name}</p>
                  <p className="text-nv-faint text-[9px] font-mono">{slot.model.size_gb} GB</p>
                </div>
                <div className="shrink-0 text-right">
                  {slot.done && !slot.error && (
                    <p className="text-nv-faint text-[9px] font-mono">{(slot.time_ms / 1000).toFixed(1)}s · {slot.token_count} tok</p>
                  )}
                  {slot.error && (
                    <p className="text-red-400 text-[9px] font-mono">error</p>
                  )}
                  {!slot.done && !slot.error && running && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  )}
                </div>
              </div>
              {/* Output */}
              <div className="flex-1 overflow-y-auto p-3">
                {slot.error ? (
                  <p className="text-red-400 text-[11px] font-mono">{slot.error}</p>
                ) : slot.output ? (
                  <p className="text-nv-text text-[12px] leading-relaxed whitespace-pre-wrap">{slot.output}</p>
                ) : (
                  <p className="text-nv-faint text-[10px] font-mono">
                    {running ? 'Waiting…' : 'No output yet'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state before first run */}
      {results.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center p-5">
          <p className="text-nv-faint text-[11px]">Select models above, type a prompt, and hit Compare.</p>
          <p className="text-nv-faint text-[10px] font-mono opacity-60">Outputs are real — streamed from Ollama on your machine.</p>
        </div>
      )}
    </div>
  );
}

// ─── Model card ──────────────────────────────────────────────────────────────

function ModelCard({
  model,
  installed,
  downloading,
  fitsSystem,
  sysRam,
  onDownload,
  onDelete,
  onRun,
}: {
  model: RegistryModel;
  installed?: InstalledModel;
  downloading?: DownloadProgress;
  fitsSystem: boolean;
  sysRam: number;
  onDownload: (m: RegistryModel) => void;
  onDelete: (id: string) => void;
  onRun: (filename: string) => void;
}) {
  const isInstalled = !!installed;
  const isDownloading = !!downloading;

  return (
    <div className={`rounded-xl border p-4 transition-fast flex flex-col gap-3
      ${isInstalled
        ? 'bg-accent/5 border-accent/30'
        : 'bg-nv-surface border-nv-border hover:border-nv-faint'
      }`}
    >
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-nv-surface2 border border-nv-border flex items-center justify-center text-sm font-bold text-nv-muted shrink-0">
          {model.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-nv-text text-[13px] font-semibold leading-tight">{model.name}</p>
            {model.gated && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 font-mono">
                token req.
              </span>
            )}
            {fitsSystem && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-mono">
                ✓ fits your PC
              </span>
            )}
            {isInstalled && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 font-mono">
                installed
              </span>
            )}
          </div>
          <p className="text-nv-faint text-[10px] mt-0.5">{model.creator} · {model.license}</p>
        </div>
      </div>

      {/* Description */}
      <p className="text-nv-muted text-[11px] leading-relaxed">{model.description}</p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{model.params}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{model.quantization}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{CONTEXT_LABELS(model.context_length)}</span>
        {model.best_for.map(t => (
          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{t}</span>
        ))}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-0 border border-nv-border rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-nv-surface2 text-center border-r border-nv-border">
          <p className="text-[8px] text-nv-faint font-mono uppercase mb-0.5">Size</p>
          <p className="text-[12px] font-semibold text-nv-text">{model.size_gb} GB</p>
        </div>
        <div className="px-3 py-2 bg-nv-surface2 text-center border-r border-nv-border">
          <p className="text-[8px] text-nv-faint font-mono uppercase mb-0.5">RAM min</p>
          <p className={`text-[12px] font-semibold ${sysRam > 0 && model.ram_min_gb > sysRam ? 'text-red-400' : 'text-nv-text'}`}>
            {model.ram_min_gb} GB
          </p>
        </div>
        <div className="px-3 py-2 bg-nv-surface2 text-center">
          <p className="text-[8px] text-nv-faint font-mono uppercase mb-0.5">{model.benchmark_humaneval ? 'HumanEval' : 'MMLU'}</p>
          <p className="text-[12px] font-semibold text-nv-text">
            {model.benchmark_humaneval ? `${model.benchmark_humaneval}%` : model.benchmark_mmlu ? `${model.benchmark_mmlu}%` : '—'}
          </p>
        </div>
      </div>

      {/* Pull command */}
      <div className="flex items-center gap-2 bg-nv-bg border border-nv-border rounded-lg px-3 py-1.5">
        <span className="text-accent text-[10px] font-mono shrink-0">$</span>
        <code className="text-nv-muted text-[10px] font-mono flex-1">adris pull {model.id}</code>
        <button
          onClick={() => navigator.clipboard.writeText(`adris pull ${model.id}`)}
          className="text-[9px] text-nv-faint hover:text-nv-text transition-fast shrink-0 font-mono"
        >copy</button>
      </div>

      {/* Download progress */}
      {isDownloading && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 bg-nv-surface2 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${downloading!.pct}%` }}
            />
          </div>
          <p className="text-[9px] text-nv-faint font-mono text-center">
            Downloading… {downloading!.downloaded_gb.toFixed(2)} / {downloading!.total_gb.toFixed(2)} GB · {downloading!.pct}%
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        {isInstalled ? (
          <>
            <button
              onClick={() => onRun(model.hf_filename ?? '')}
              className="flex-1 text-[11px] py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast font-medium"
            >
              ▶ Run in Coder
            </button>
            <button
              onClick={() => onDelete(model.id)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:border-red-500/40 hover:text-red-400 transition-fast"
            >
              Delete
            </button>
          </>
        ) : isDownloading ? (
          <button disabled className="flex-1 text-[11px] py-1.5 rounded-lg bg-nv-surface2 text-nv-faint cursor-not-allowed">
            Downloading…
          </button>
        ) : (
          <button
            onClick={() => onDownload(model)}
            className="flex-1 text-[11px] py-1.5 rounded-lg bg-nv-surface border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast flex items-center justify-center gap-1.5"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M5.5 1v7M2 5.5l3.5 3.5L9 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
            </svg>
            Pull {model.size_gb} GB
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Gated download modal ─────────────────────────────────────────────────────

function GatedModal({ info, onCancel, onConfirm }: {
  info: PullResponse;
  onCancel: () => void;
  onConfirm: (token: string) => void;
}) {
  const [token, setToken] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nv-surface border border-nv-border rounded-2xl p-6 max-w-md w-full mx-4 flex flex-col gap-4">
        <div>
          <p className="text-nv-text text-[13px] font-semibold">{info.name} — License Required</p>
          <p className="text-nv-faint text-[11px] mt-1 leading-relaxed">{info.message}</p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => window.open(info.token_url, '_blank')}
            className="text-[11px] py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast"
          >
            Accept {info.name} license agreement →
          </button>
          <input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your access token (hf_…)"
            className="text-[11px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text placeholder:text-nv-faint font-mono"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 text-[11px] py-2 rounded-lg border border-nv-border text-nv-faint hover:text-nv-text transition-fast">
            Cancel
          </button>
          <button
            disabled={!token.startsWith('hf_')}
            onClick={() => onConfirm(token)}
            className="flex-1 text-[11px] py-2 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-40"
          >
            Download with token
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ModelsModule() {
  const [tab, setTab] = useState<'hub' | 'mymodels' | 'compare' | 'lora'>('hub');
  const [registry, setRegistry] = useState<RegistryModel[]>([]);
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState<Record<string, DownloadProgress>>({});
  const [sysInfo, setSysInfo] = useState<SysInfo | null>(null);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo>({ name: 'Detecting…', vram_gb: 0 });
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [gatedModal, setGatedModal] = useState<PullResponse | null>(null);
  const [pendingModel, setPendingModel] = useState<RegistryModel | null>(null);
  const [_showSpecsBar, _setShowSpecsBar]           = useState(false);
  const [showHardwareReport, setShowHardwareReport] = useState(false);
  // Import model flow
  const [showImport, setShowImport] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importName, setImportName] = useState('');
  const [importCtx, setImportCtx] = useState(4096);
  const [importFmt, setImportFmt] = useState<'gguf' | 'safetensors'>('gguf');
  const [importing, setImporting] = useState(false);
  const filterByPC = filter === '__pc__';

  useEffect(() => {
    // Catalogue is static — no external API call, works offline
    setRegistry(DESKTOP_MODELS);

    // Load system info
    invoke<SysInfo>('get_system_info').then(setSysInfo).catch(() => {});
    invoke<GpuInfo[]>('detect_gpu').then(gpus => {
      if (gpus.length > 0) setGpuInfo(gpus[0]);
      else setGpuInfo({ name: 'No dedicated GPU', vram_gb: 0 });
    }).catch(() => setGpuInfo({ name: 'Unknown', vram_gb: 0 }));

    // Load installed models
    refreshInstalled();

    // Check Ollama
    invoke<boolean>('models_check_ollama').then(setOllamaOk).catch(() => setOllamaOk(false));

    // Listen for download events
    const unP = listen<{ model_id: string; pct: number; downloaded_gb: number; total_gb: number }>(
      'model_download_progress',
      e => setDownloading(prev => ({
        ...prev,
        [e.payload.model_id]: { pct: e.payload.pct, downloaded_gb: e.payload.downloaded_gb, total_gb: e.payload.total_gb },
      }))
    );
    const unC = listen<{ model_id: string }>('model_download_complete', e => {
      setDownloading(prev => { const n = { ...prev }; delete n[e.payload.model_id]; return n; });
      refreshInstalled();
    });

    return () => {
      unP.then(fn => fn());
      unC.then(fn => fn());
    };
  }, []);

  function refreshInstalled() {
    invoke<InstalledModel[]>('models_list_installed')
      .then(setInstalled)
      .catch(() => {});
  }

  const sysRam = sysInfo?.total_ram_gb ?? 0;

  function modelFitsPC(m: RegistryModel): boolean {
    return sysRam > 0 && m.ram_min_gb <= sysRam;
  }

  function getHardwareRecommendations(): { category: string; models: RegistryModel[] }[] {
    const ram = sysRam;
    if (ram === 0) return [];
    const fits = DESKTOP_MODELS.filter(m => m.ram_min_gb <= ram && !m.mesh_required);
    const pick = (tag: string) => {
      const tagged = fits.filter(m => m.best_for.includes(tag));
      tagged.sort((a, b) => b.ram_min_gb - a.ram_min_gb);
      return tagged.slice(0, 3);
    };
    return [
      { category: 'Best overall for your RAM', models: (() => { const s = [...fits]; s.sort((a, b) => b.ram_min_gb - a.ram_min_gb); return s.slice(0, 3); })() },
      { category: 'Coding',   models: pick('coding') },
      { category: 'Chat',     models: pick('chat') },
      { category: 'Reasoning', models: pick('reasoning') },
      { category: 'Writing',  models: pick('writing') },
    ].filter(c => c.models.length > 0);
  }

  // ─── Filtered model list ──────────────────────────────────────────────────

  const filteredModels = registry.filter(m => {
    if (filterByPC && !modelFitsPC(m)) return false;
    if (filter === 'cpu') { if (!m.cpu_only) return false; }
    else if (filter !== 'all' && filter !== '__pc__' && !m.best_for.includes(filter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return m.name.toLowerCase().includes(q)
        || m.creator.toLowerCase().includes(q)
        || m.id.toLowerCase().includes(q)
        || m.best_for.some(t => t.includes(q));
    }
    return true;
  });

  // ─── Download handler ─────────────────────────────────────────────────────

  async function handleDownload(model: RegistryModel) {
    try {
      const resp = await fetch(`${PULL_URL}?model=${model.id}`, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) throw new Error('not deployed');
      const data: PullResponse = await resp.json();

      if (data.gated) {
        setPendingModel(model);
        setGatedModal(data);
        return;
      }

      startDownload(model, data.download_url!, data.filename!, model.size_gb);
    } catch {
      // Pull API not deployed yet — inform user how to get the model now
      alert(
        `Could not reach the download server. Check your internet connection and try again.\n\n` +
        `If the problem continues, you can download this model manually:\n` +
        `  1. Install Ollama from ollama.com\n` +
        `  2. Run:  ollama pull ${model.id.replace(/-q4$/, '')}\n` +
        `  3. Use the "Import model" button in My Models to register it.`
      );
    }
  }

  async function startDownload(model: RegistryModel, url: string, filename: string, size_gb: number, token?: string) {
    const downloadUrl = token
      ? url.replace('huggingface.co', `user:${token}@huggingface.co`)
      : url;
    setDownloading(prev => ({ ...prev, [model.id]: { pct: 0, downloaded_gb: 0, total_gb: size_gb } }));
    invoke('models_download', {
      modelId: model.id,
      modelName: model.name,
      url: downloadUrl,
      filename,
      sizeGb: size_gb,
    }).catch(e => {
      setDownloading(prev => { const n = { ...prev }; delete n[model.id]; return n; });
      alert(`Download failed: ${e}`);
    });
  }

  async function handleDelete(modelId: string) {
    if (!confirm('Delete this model from your machine?')) return;
    await invoke('models_delete', { modelId }).catch(() => {});
    refreshInstalled();
  }

  async function handleRun(filename: string) {
    if (!ollamaOk) {
      alert('Ollama is not running. Install Ollama from ollama.com, then try again.');
      return;
    }
    await invoke('models_run', { modelFilename: filename }).catch(e => alert(`Could not start: ${e}`));
  }

  async function handlePickFile() {
    const path = await invoke<string | null>('models_pick_file').catch(() => null);
    if (!path) return;
    setImportPath(path);
    // Pre-fill name from filename
    const filename = path.split(/[\\/]/).pop() ?? '';
    const guessed = filename.replace(/\.gguf$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    setImportName(guessed);
  }

  async function handleImport() {
    if (!importPath || !importName) return;
    setImporting(true);
    try {
      await invoke('models_import', {
        sourcePath: importPath,
        modelName: importName,
        contextLength: importCtx,
        format: importFmt,
      });
      refreshInstalled();
      setShowImport(false);
      setImportPath('');
      setImportName('');
    } catch (e) {
      alert(`Import failed: ${e}`);
    } finally {
      setImporting(false);
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-nv-bg">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" style={{ opacity: 0.05 }}>
        <svg viewBox="0 0 1000 1000" fill="none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
          <g style={{ transformOrigin: '500px 500px', animation: 'nv-orbit-cw 14s linear infinite' }} stroke="currentColor" strokeWidth="1.2" fill="none" className="text-nv-muted">
            <path d="M500 140 L860 320 L500 500 L140 320 Z"/>
            <path d="M140 320 L500 680 L860 320"/>
          </g>
          <g style={{ transformOrigin: '500px 500px', animation: 'nv-orbit-ccw 9s linear infinite' }} stroke="#7C5CFF" strokeWidth="1.4" fill="none" opacity="0.6">
            <path d="M500 280 L720 380 L500 480 L280 380 Z"/>
            <circle cx="500" cy="430" r="6" fill="#7C5CFF" stroke="none"/>
          </g>
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-14 border-b border-nv-border bg-nv-surface shrink-0 relative z-10">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('hub')}
            className={`text-[11px] px-3 py-1 rounded-lg transition-fast font-medium ${tab === 'hub' ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:text-nv-text'}`}
          >
            Model Hub {registry.length > 0 ? `· ${filteredModels.length}` : ''}
          </button>
          <button
            onClick={() => setTab('mymodels')}
            className={`text-[11px] px-3 py-1 rounded-lg transition-fast font-medium ${tab === 'mymodels' ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:text-nv-text'}`}
          >
            My Models · {installed.length}
          </button>
          <button
            onClick={() => setTab('compare')}
            className={`text-[11px] px-3 py-1 rounded-lg transition-fast font-medium ${tab === 'compare' ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:text-nv-text'}`}
          >
            Compare
          </button>
          <button
            onClick={() => setTab('lora')}
            className={`text-[11px] px-3 py-1 rounded-lg transition-fast font-medium ${tab === 'lora' ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:text-nv-text'}`}
          >
            LoRA Adapters · {LORA_DATA.length}
          </button>
        </div>

        <div className="flex-1" />

        {/* Search */}
        {tab === 'hub' && (
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models…"
            className="text-[11px] px-3 py-1.5 rounded-lg bg-nv-bg border border-nv-border text-nv-text placeholder:text-nv-faint w-48"
          />
        )}

        {/* Ollama status */}
        <div className={`flex items-center gap-1.5 text-[10px] font-mono ${ollamaOk ? 'text-emerald-400' : 'text-nv-faint'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${ollamaOk ? 'bg-emerald-400' : 'bg-nv-faint'}`} />
          {ollamaOk ? 'Ollama ready' : 'Ollama offline'}
        </div>
      </div>

      {/* Your machine specs bar */}
      <div
        className="flex items-center gap-3 px-5 py-2 border-b border-nv-border bg-nv-surface/50 shrink-0 relative z-10 cursor-pointer select-none"
        onClick={() => _setShowSpecsBar((p: boolean) => !p)}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-nv-faint font-mono">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1"/><path d="M3 5h4M5 3v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
          Your machine
        </div>
        <span className="text-[10px] font-mono text-nv-muted">{sysRam > 0 ? `${sysRam.toFixed(1)} GB RAM` : 'Detecting…'}</span>
        <span className="text-nv-border">·</span>
        <span className="text-[10px] font-mono text-nv-muted">{sysInfo?.cpu_count ?? '?'} CPU cores</span>
        <span className="text-nv-border">·</span>
        <span className="text-[10px] font-mono text-nv-muted">{gpuInfo.name}{gpuInfo.vram_gb > 0 ? ` · ${gpuInfo.vram_gb} GB VRAM` : ''}</span>
        <div className="flex-1" />
        <button
          onClick={e => { e.stopPropagation(); setShowHardwareReport(r => !r); }}
          className={`text-[10px] px-2.5 py-1 rounded-lg border transition-fast font-mono shrink-0 ${
            showHardwareReport
              ? 'bg-accent/15 text-accent border-accent/40'
              : 'border-nv-border text-nv-faint hover:border-nv-faint'
          }`}
        >
          {showHardwareReport ? 'Hide report' : 'Check what runs on my laptop'}
        </button>
        {tab === 'hub' && (
          <button
            onClick={e => { e.stopPropagation(); setFilter(filterByPC ? 'all' : '__pc__'); }}
            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-fast font-mono ${
              filterByPC
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'border-nv-border text-nv-faint hover:border-nv-faint'
            }`}
          >
            {filterByPC ? '✓ Showing: fits my PC' : 'Filter by my PC'}
          </button>
        )}
      </div>

      {/* ── HARDWARE REPORT PANEL ──────────────────────────────────────────── */}
      {showHardwareReport && (
        <div className="shrink-0 border-b border-nv-border bg-nv-bg px-5 py-4 overflow-y-auto" style={{ maxHeight: 340 }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[12px] font-semibold text-nv-text">Hardware compatibility report</p>
              <p className="text-[10px] text-nv-muted font-mono mt-0.5">
                {sysRam > 0 ? `${sysRam.toFixed(1)} GB RAM · ${sysInfo?.cpu_count ?? '?'} cores · ${gpuInfo.name}${gpuInfo.vram_gb > 0 ? ` · ${gpuInfo.vram_gb} GB VRAM` : ''}` : 'Scanning hardware…'}
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 shrink-0">
              {DESKTOP_MODELS.filter(m => (sysRam > 0 ? m.ram_min_gb <= sysRam : false) && !m.mesh_required).length} models compatible
            </span>
          </div>
          {sysRam === 0 ? (
            <p className="text-[11px] text-nv-faint font-mono">Detecting your hardware…</p>
          ) : (
            <div className="space-y-3">
              {getHardwareRecommendations().map(cat => (
                <div key={cat.category}>
                  <p className="text-[9px] font-mono uppercase tracking-widest text-accent/70 mb-1.5">{cat.category}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {cat.models.map((m, i) => (
                      <div key={m.id} className={`rounded-lg border px-3 py-2 ${i === 0 ? 'border-accent/30 bg-accent/5' : 'border-nv-border bg-nv-surface'}`}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {i === 0 && <span className="text-[8px] font-mono text-accent">TOP</span>}
                          <span className="text-[11px] font-semibold text-nv-text truncate">{m.name}</span>
                        </div>
                        <span className="text-[9px] font-mono text-nv-muted">{m.params} · {m.ram_min_gb} GB min</span>
                        <p className="text-[9px] text-nv-faint mt-0.5 leading-tight truncate">{m.description.split('.')[0]}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {sysRam < 4 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <span className="text-yellow-400 text-[11px]">⚠</span>
                  <p className="text-[10px] text-yellow-400">Your RAM is very low. Only tiny models (1–2 GB) will run smoothly.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── HUB TAB ────────────────────────────────────────────────────────── */}
      {tab === 'hub' && (
        <div className="flex-1 overflow-hidden flex flex-col relative z-10">
          {/* Filter pills */}
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-nv-border bg-nv-surface/30 shrink-0 overflow-x-auto">
            {Object.entries(FILTER_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-[10px] px-3 py-1 rounded-full border whitespace-nowrap transition-fast shrink-0 ${
                  filter === key
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-nv-border text-nv-faint hover:border-nv-faint'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Model grid */}
          <div className="flex-1 overflow-y-auto p-5">
            {filteredModels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <p className="text-nv-faint text-sm">No models match your filters.</p>
                <button onClick={() => { setFilter('all'); setSearch(''); }} className="text-xs text-accent hover:underline">Clear filters</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 max-w-3xl">
                {filteredModels.map(m => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    installed={installed.find(i => i.id === m.id)}
                    downloading={downloading[m.id]}
                    fitsSystem={modelFitsPC(m)}
                    sysRam={sysRam}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    onRun={handleRun}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MY MODELS TAB ──────────────────────────────────────────────────── */}
      {tab === 'mymodels' && (
        <div className="flex-1 overflow-y-auto p-5 relative z-10">

          {/* Import model panel */}
          {showImport && (
            <div className="mb-5 p-4 rounded-xl border border-nv-border bg-nv-surface flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-nv-text text-[12px] font-semibold">Import external model</p>
                <button onClick={() => setShowImport(false)} className="text-nv-faint hover:text-nv-text text-[11px]">× Cancel</button>
              </div>

              {/* Friction notice */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-nv-bg border border-nv-border">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-amber-400 shrink-0 mt-0.5"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1"/><path d="M6.5 4v3M6.5 9h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                <p className="text-nv-faint text-[10px] leading-relaxed">
                  Manual import requires filling in all fields below. <span className="text-nv-text">Models downloaded via adris.tech attach automatically</span> — no setup needed.
                </p>
              </div>

              {/* File picker */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-nv-faint font-mono uppercase">Model file (.gguf)</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={importPath}
                    placeholder="No file selected"
                    className="flex-1 text-[11px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-muted placeholder:text-nv-faint font-mono"
                  />
                  <button
                    onClick={handlePickFile}
                    className="text-[11px] px-3 py-2 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast shrink-0"
                  >Browse…</button>
                </div>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-nv-faint font-mono uppercase">Model name</label>
                  <input
                    value={importName}
                    onChange={e => setImportName(e.target.value)}
                    placeholder="e.g. My Custom Mistral"
                    className="text-[11px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text placeholder:text-nv-faint"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-nv-faint font-mono uppercase">Context length</label>
                  <select
                    value={importCtx}
                    onChange={e => setImportCtx(Number(e.target.value))}
                    className="text-[11px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text"
                  >
                    <option value={2048}>2K</option>
                    <option value={4096}>4K</option>
                    <option value={8192}>8K</option>
                    <option value={16384}>16K</option>
                    <option value={32768}>32K</option>
                    <option value={131072}>128K</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-nv-faint font-mono uppercase">Format</label>
                  <select
                    value={importFmt}
                    onChange={e => setImportFmt(e.target.value as 'gguf' | 'safetensors')}
                    className="text-[11px] px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text"
                  >
                    <option value="gguf">GGUF</option>
                    <option value="safetensors">Safetensors</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setShowImport(false)} className="flex-1 text-[11px] py-2 rounded-lg border border-nv-border text-nv-faint hover:text-nv-text transition-fast">
                  Cancel
                </button>
                <button
                  disabled={!importPath || !importName || importing}
                  onClick={handleImport}
                  className="flex-1 text-[11px] py-2 rounded-lg bg-nv-surface border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast disabled:opacity-40"
                >
                  {importing ? 'Copying…' : 'Import model'}
                </button>
              </div>
            </div>
          )}

          {installed.length === 0 && !showImport ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="w-12 h-12 rounded-xl border border-nv-border flex items-center justify-center text-nv-faint">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2v12M4 10l6 6 6-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="M2 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div>
                <p className="text-nv-text text-[13px] font-semibold">No models downloaded yet</p>
                <p className="text-nv-faint text-[11px] mt-1">Go to Model Hub and pull a model to get started.</p>
              </div>
              <button onClick={() => setTab('hub')} className="text-[11px] px-4 py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast">
                Browse Model Hub →
              </button>
              <button onClick={() => setShowImport(true)} className="text-[10px] text-nv-faint hover:text-nv-text transition-fast">
                or import an existing .gguf file
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-nv-faint text-[10px] font-mono">
                  {installed.length} model{installed.length > 1 ? 's' : ''} installed
                  {ollamaOk
                    ? ' · Ollama ready — click Run to load into Coder'
                    : ' · Install Ollama to run models locally'
                  }
                </p>
                {!showImport && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="text-[10px] px-2.5 py-1 rounded-lg border border-nv-border text-nv-faint hover:border-nv-faint hover:text-nv-text transition-fast font-mono"
                  >
                    + Import model
                  </button>
                )}
              </div>
              {installed.map(m => {
                const reg = registry.find(r => r.id === m.id);
                return (
                  <div key={m.id} className="flex items-center gap-4 p-4 rounded-xl bg-nv-surface border border-nv-border hover:border-nv-faint transition-fast">
                    <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent text-sm font-bold shrink-0">
                      {m.name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-nv-text text-[13px] font-medium">{m.name}</p>
                      <p className="text-nv-faint text-[10px] font-mono mt-0.5">
                        {m.size_gb} GB · {reg ? `${reg.params} · ${reg.quantization}` : m.filename}
                      </p>
                      {reg && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {reg.best_for.map(t => (
                            <span key={t} className="text-[8px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{t}</span>
                          ))}
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{CONTEXT_LABELS(reg.context_length)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleRun(m.filename)}
                        title={ollamaOk ? 'Run this model in Coder' : 'Ollama not running'}
                        className={`text-[11px] px-3 py-1.5 rounded-lg transition-fast font-medium ${
                          ollamaOk
                            ? 'bg-accent text-white hover:bg-accent-dim'
                            : 'bg-nv-surface2 text-nv-faint cursor-not-allowed'
                        }`}
                      >
                        ▶ Run
                      </button>
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-faint hover:border-red-500/40 hover:text-red-400 transition-fast"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Storage info */}
              <div className="mt-2 p-3 rounded-lg border border-nv-border bg-nv-surface/50 flex items-center gap-3">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-nv-faint shrink-0"><rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1"/><path d="M4 7h6M4 5h2M4 9h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
                <div className="flex-1 min-w-0">
                  <p className="text-nv-faint text-[10px] font-mono">
                    {installed.reduce((s, m) => s + m.size_gb, 0).toFixed(1)} GB used by adris.tech models
                  </p>
                </div>
                <p className="text-nv-faint text-[9px] font-mono">%APPDATA%\Nivara\nivara-models\</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── COMPARE TAB ────────────────────────────────────────────────────── */}
      {tab === 'compare' && (
        <CompareTab installed={installed} sysRam={sysRam} ollamaOk={ollamaOk} />
      )}

      {/* ── LORA TAB ───────────────────────────────────────────────────────── */}
      {tab === 'lora' && (
        <div className="flex-1 overflow-y-auto p-5 relative z-10">
          <div className="max-w-2xl flex flex-col gap-4">
            {/* Notice banner */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl border border-nv-border bg-nv-surface">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-nv-faint shrink-0 mt-0.5"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1"/><path d="M6.5 4v3M6.5 9h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              <p className="text-nv-faint text-[10px] leading-relaxed">
                LoRA adapters are small files (50–300 MB) that specialise a base model for a specific task — no retraining needed. <span className="text-nv-muted">Free adapters ship with app release. Paid adapters unlock after purchase.</span>
              </p>
            </div>

            {/* LoRA cards */}
            {LORA_DATA.map(lora => {
              const isFree = lora.price_inr === 0;
              return (
                <div key={lora.id} className="p-4 rounded-xl border border-nv-border bg-nv-surface flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-nv-text text-[13px] font-semibold">{lora.name}</p>
                        {isFree ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">Free</span>
                        ) : (
                          <span className="text-[9px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-mono">₹{lora.price_inr}</span>
                        )}
                      </div>
                      <p className="text-nv-faint text-[10px] mt-0.5 font-mono">requires · {lora.base_model}</p>
                    </div>
                    <div className="text-[9px] text-nv-faint font-mono shrink-0">{lora.size_mb} MB</div>
                  </div>

                  <p className="text-nv-muted text-[11px] leading-relaxed">{lora.description}</p>

                  <div className="flex flex-wrap gap-1">
                    {lora.tags.map(t => (
                      <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{t}</span>
                    ))}
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-nv-surface2 text-nv-faint border border-nv-border font-mono">{lora.license}</span>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-nv-border">
                    {isFree ? (
                      <button
                        disabled
                        className="text-[11px] px-4 py-1.5 rounded-lg border border-nv-border text-nv-faint opacity-50 cursor-not-allowed font-mono"
                        title="Available with app release"
                      >
                        Download · Ships with app release
                      </button>
                    ) : (
                      <button
                        disabled
                        className="text-[11px] px-4 py-1.5 rounded-lg border border-nv-border text-nv-faint opacity-50 cursor-not-allowed font-mono"
                        title="Paid LoRAs unlock after purchase — coming soon"
                      >
                        Buy ₹{lora.price_inr} · Coming soon
                      </button>
                    )}
                    <p className="text-nv-faint text-[9px] font-mono ml-auto">
                      Base: <span className="text-nv-muted">{lora.base_model}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gated model modal */}
      {gatedModal && pendingModel && (
        <GatedModal
          info={gatedModal}
          onCancel={() => { setGatedModal(null); setPendingModel(null); }}
          onConfirm={async token => {
            setGatedModal(null);
            const url = `https://huggingface.co/${pendingModel.hf_repo ?? ''}/resolve/main/${pendingModel.hf_filename ?? ''}?token=${token}`;
            await startDownload(pendingModel, url, pendingModel.hf_filename ?? '', pendingModel.size_gb, token);
            setPendingModel(null);
          }}
        />
      )}
    </div>
  );
}
