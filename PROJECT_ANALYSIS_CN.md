# DeepSite 项目分析文档

## 目录

1.  [系统架构](#1-系统架构)
2.  [AI模块详解](#2-ai模块详解)
    *   [AI请求处理流程](#ai请求处理流程)
    *   [当前模型集成方式](#当前模型集成方式)
    *   [系统提示词的角色和内容](#系统提示词的角色和内容)
    *   [AI生成代码的数据流](#ai生成代码的数据流)
3.  [网页生成与编辑逻辑](#3-网页生成与编辑逻辑)
    *   [编辑器如何发送提示及处理AI响应](#编辑器如何发送提示及处理ai响应)
    *   [当前限制与中文内容考量](#当前限制与中文内容考量)
4.  [项目管理（保存/加载）](#4-项目管理保存加载)
5.  [国际化（I18n）与中文支持](#5-国际化i18n与中文支持)
    *   [UI翻译的现状与计划](#ui翻译的现状与计划)
    *   [后端和数据库处理中文字符](#后端和数据库处理中文字符)
6.  [针对用户需求的分析总结](#6-针对用户需求的分析总结)
    *   [关于Langchain的确认](#关于langchain的确认)
    *   [AI交互点通用化评估](#ai交互点通用化评估)
    *   [单页生成逻辑改造以支持多文件项目](#单页生成逻辑改造以支持多文件项目)

---

## 1. 系统架构

DeepSite项目是一个基于Next.js框架构建的Web应用，旨在通过AI辅助用户生成和编辑网页代码。其主要组成部分如下：

*   **前端 (Client-side):**
    *   使用Next.js进行页面渲染和路由管理。
    *   UI基于React构建，并大量使用TailwindCSS进行样式设计。
    *   核心交互界面包括：
        *   一个Monaco Editor实例，用于代码展示和编辑。
        *   一个AI交互面板（`AskAI`组件），用户在此输入提示词与AI沟通。
        *   一个预览面板（`Preview`组件），通过iframe实时展示生成的HTML效果。
    *   状态管理主要通过React Context (`AppContext`) 和自定义Hooks (`useEditor`) 实现。
    *   使用`@tanstack/react-query`进行部分异步数据获取和状态管理。

*   **后端 (Server-side - Next.js API Routes):**
    *   利用Next.js的API路由功能处理所有后端逻辑。
    *   `app/api/ask-ai/route.ts`: 核心AI交互接口，处理代码生成 (`POST`) 和代码修改 (`PUT`) 请求。
    *   `app/api/me/projects/route.ts`: 处理用户项目相关的操作，如获取项目列表 (`GET`) 和创建新项目并部署到Hugging Face Spaces (`POST`)。
    *   `app/api/auth/route.ts`: (推测)处理用户认证相关逻辑。
    *   `app/api/me/route.ts`: (推测)获取当前用户信息。

*   **数据库 (MongoDB):**
    *   通过Mongoose库与MongoDB交互。
    *   `models/Project.ts` 定义了项目的数据模型，主要存储项目的元数据，如Hugging Face Space ID (`space_id`) 和用户提示历史 (`prompts`)。**HTML内容本身不存储在此数据库中。**

*   **AI模型服务 (Hugging Face):**
    *   通过 `@huggingface/inference` 库与Hugging Face Inference API进行交互，以调用AI大模型（如DeepSeek系列）。
    *   通过 `@huggingface/hub` 库与Hugging Face Hub交互，用于创建和部署项目到Hugging Face Spaces。

*   **交互流程概要:**
    1.  用户在前端UI（`AskAI`组件）输入需求。
    2.  前端将请求（包含提示、当前代码、选择的模型/provider等）发送到后端的 `/api/ask-ai` 路由。
    3.  后端API路由处理认证、限流，然后构造请求参数，通过 `@huggingface/inference` 调用Hugging Face Inference API。
    4.  AI模型返回代码（初始生成时为完整HTML流，修改时为特定格式的 diff块）。
    5.  后端API将AI的响应处理后返回给前端。
    6.  前端更新编辑器内容和预览。
    7.  用户创建项目时，HTML内容和`README.md`被推送到Hugging Face Spaces，项目元数据保存到MongoDB。

## 2. AI模块详解

### AI请求处理流程

AI请求主要由 `app/api/ask-ai/route.ts` 文件中的 `POST` 和 `PUT` 方法处理。

**通用前置处理 (POST 和 PUT):**

1.  **认证检查:** 从Cookie中获取用户Token，或检查是否存在 `process.env.HF_TOKEN` (用于本地开发)。
2.  **匿名用户限流:** 若无Token，则基于IP进行请求次数限制 (当前为 `MAX_REQUESTS_PER_IP = 2`)。超限则提示登录。
3.  **Token准备:** 若无用户Token且未超限，则使用 `process.env.DEFAULT_HF_TOKEN`，并设置 `billTo = "huggingface"`。
4.  **参数解析:** 从请求体中获取 `prompt`, `provider`, `model`, `html`, `redesignMarkdown` 等参数。
5.  **模型与Provider校验:**
    *   根据传入的 `model` 值在 `lib/providers.ts` 的 `MODELS` 数组中查找模型配置。
    *   根据传入的 `provider` 值或模型的 `autoProvider` 在 `PROVIDERS` 对象中选择Hugging Face Inference API的provider。
    *   校验所选模型是否支持所选provider。

**`POST` 请求 (初始代码生成):**

1.  **构造消息:**
    *   系统消息: `INITIAL_SYSTEM_PROMPT` (来自 `lib/prompts.ts`)。
    *   用户消息: 基于 `prompt`, `redesignMarkdown`, 或 `html` (作为上下文)。
2.  **调用AI:** 使用 `InferenceClient.chatCompletionStream()` 以流式方式请求AI模型。
3.  **流式响应处理:**
    *   逐步接收AI生成的代码块。
    *   根据模型特性 (如 `isThinker`) 和特定provider (如 "sambanova") 可能有不同的结束判断逻辑 (如检查 `</html>` 或 `</think>`)。
    *   将数据流式返回给前端。
4.  **错误处理:** 捕获包括额度超限在内的API错误，并以JSON格式返回。

**`PUT` 请求 (代码修改):**

1.  **模型选择:** **注意：此处理器当前硬编码使用 `MODELS[0]`** (即`lib/providers.ts`中定义的第一个模型)，而不是用户在前端选择的模型。
2.  **构造消息:**
    *   系统消息: `FOLLOW_UP_SYSTEM_PROMPT` (来自 `lib/prompts.ts`)。
    *   用户消息 (作为先前对话): `previousPrompt` 或默认修改提示。
    *   助手消息 (作为上下文): 当前 `html` 代码，以及可选的 `selectedElementHtml` (提示AI仅修改此部分)。
    *   用户消息 (当前指令): `prompt`。
3.  **调用AI:** 使用 `InferenceClient.chatCompletion()` 以非流式方式请求AI模型。
4.  **响应解析:**
    *   AI被期望返回遵循特定 `SEARCH/REPLACE` 格式的文本块。
    *   后端解析这些块，并在提供的 `html` 上应用更改，生成新的HTML。
    *   记录被修改的行号。
5.  **返回结果:** 以JSON格式返回修改后的HTML和更新的行号。
6.  **错误处理:** 同 `POST` 请求。

### 当前模型集成方式

*   **核心库:** `@huggingface/inference`。
*   **客户端初始化:** `new InferenceClient(token)`，使用Hugging Face API Token。
*   **API调用:**
    *   `client.chatCompletionStream()`: 用于流式聊天补全 (主要用于代码生成)。
    *   `client.chatCompletion()`: 用于非流式聊天补全 (主要用于代码修改)。
*   **参数传递:**
    *   `model`: AI模型的ID (例如 `"deepseek-ai/DeepSeek-V3-0324"`)。
    *   `provider`: Hugging Face Inference API内部的计算服务提供商标示 (例如 `"novita"`)。
    *   `messages`: 符合OpenAI格式的对话历史数组。
    *   `max_tokens`: 根据所选 `provider` 配置的最大输出Token数。
    *   `billTo`: (可选) 计费账户标识。

### 系统提示词的角色和内容

系统提示词定义在 `lib/prompts.ts` 中，对AI的行为起着决定性作用。

*   **`INITIAL_SYSTEM_PROMPT` (用于初始生成):**
    *   **核心指令:**
        *   技术栈限制: `ONLY USE HTML, CSS AND JAVASCRIPT.`
        *   UI/UX要求: 追求最佳UI，响应式设计 (`MAKE IT RESPONSIVE USING TAILWINDCSS`)。
        *   TailwindCSS优先: `Use as much as you can TailwindCSS... if you can't... use custom CSS (make sure to import <script src="https://cdn.tailwindcss.com"></script> in the head).`
        *   **单文件输出:** `ALWAYS GIVE THE RESPONSE INTO A SINGLE HTML FILE.` (这是导致目前只生成单HTML文件的关键)
        *   鼓励创新: `try to ellaborate as much as you can, to create something unique.`
    *   **影响:** 确保生成内容的技术一致性，并强制输出为单个HTML文件。

*   **`FOLLOW_UP_SYSTEM_PROMPT` (用于代码修改):**
    *   **核心指令:**
        *   设定AI角色: `You are an expert web developer modifying an existing HTML file.`
        *   **强制输出格式:** `You MUST output ONLY the changes required using the following SEARCH/REPLACE block format. Do NOT output the entire file.`
        *   详细定义了 `<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE` 标记的使用规则，包括如何插入和删除代码。
        *   强调`SEARCH`块必须与当前代码**精确匹配**。
    *   **影响:** 使得AI的修改可以被程序化地精确应用，减少了数据传输，但对AI遵循格式的能力要求很高。

### AI生成代码的数据流

1.  **前端 (用户输入):** 用户在 `AskAI` 组件输入提示词。
2.  **前端 (请求准备):** `AskAI` 组件根据当前状态 (如是初次生成还是修改、是否有选中元素等) 准备请求体，包含提示、当前HTML (如果适用)、模型/provider选择等。
3.  **HTTP请求:** 前端通过 `fetch` API将请求发送到后端 `/api/ask-ai` (POST或PUT)。
4.  **后端 (接收与预处理):** Next.js API路由接收请求，进行认证、参数校验。
5.  **后端 (AI调用):** 使用 `@huggingface/inference` 客户端库，将处理后的参数（包括系统提示词和用户消息）发送给Hugging Face Inference API。
6.  **Hugging Face API:** 处理请求，调用指定的AI大模型进行推理。
7.  **AI模型响应:** 模型生成代码。
    *   对于初始生成 (POST): 以数据流的形式返回HTML代码块。
    *   对于修改 (PUT): 返回包含`SEARCH/REPLACE`指令的文本块。
8.  **后端 (响应处理):**
    *   POST: 将AI的流式响应直接转发给前端。
    *   PUT: 解析`SEARCH/REPLACE`块，应用到原HTML上，生成新HTML。
9.  **HTTP响应:** 后端将处理后的结果返回给前端。
    *   POST: text/plain流。
    *   PUT: JSON对象，包含新的HTML和修改的行号。
10. **前端 (结果展示):**
    *   `AskAI` 组件接收响应。
    *   通过 `setHtml` 更新 `AppEditor` 中的 `html` 状态。
    *   Monaco Editor显示新代码，Preview iframe渲染新页面。
    *   对于PUT请求，可能会高亮显示被修改的行。

## 3. 网页生成与编辑逻辑

### 编辑器如何发送提示及处理AI响应

*   **发送提示 (`components/editor/ask-ai/index.tsx`中的`callAi`函数):**
    1.  用户在输入框输入 `prompt`。
    2.  点击发送按钮或按Enter键触发 `callAi`。
    3.  `callAi` 函数判断是进行“初始生成/全新生成”（POST请求）还是“后续修改/Diff-Patch”（PUT请求）。
        *   判断依据：`isFollowUp` 状态（受“Diff-Patch Update”复选框影响）和 `isTheSameHtml(html)` (判断当前HTML是否为初始默认HTML)。
        *   如果用户选中了某个元素 (`selectedElement`)，其 `outerHTML` 会作为 `selectedElementHtml` 包含在PUT请求中。
    4.  构造请求体，包含 `prompt`, `html` (当前代码), `provider`, `model`, `previousPrompt` (用于PUT), `selectedElementHtml` (用于PUT)等。
    5.  使用 `fetch` API 调用后端 `/api/ask-ai`。

*   **处理AI响应:**
    *   **POST响应 (流式HTML):**
        *   通过 `ReadableStream` 和 `TextDecoder` 逐块读取。
        *   尝试解析 `<think>` 标签以显示AI思考过程。
        *   将累积的HTML内容通过 `setHtml` 实时（有节流）更新到编辑器和预览。
        *   完成后，调用 `onSuccess` 回调，更新 `htmlHistory`。
    *   **PUT响应 (JSON对象包含新HTML和变动行号):**
        *   直接解析JSON。
        *   使用 `setHtml` 更新为返回的新HTML。
        *   调用 `onSuccess` 回调，更新 `htmlHistory`，并利用返回的 `updatedLines` 在Monaco Editor中高亮修改区域。
    *   **错误处理:** 统一处理API返回的特定错误（如要求登录、选择Provider、升级Pro）或通用错误，并通过 `toast` 通知用户。

### 当前限制与中文内容考量

*   **当前限制:**
    *   **单HTML文件输出:** 由 `INITIAL_SYSTEM_PROMPT` 强制规定，所有内容（HTML结构、CSS样式、JS脚本）都在一个文件中。这限制了项目的可维护性、可扩展性和复杂性。
    *   **硬编码的PUT请求模型:** 后端 `PUT` 路由处理器硬编码使用 `MODELS[0]`，忽略了用户在前端对模型的选择。
    *   **HTML历史仅限客户端:** `htmlHistory` 不会被持久化保存。
    *   **项目加载不直接加载HTML:** 加载项目时，前端仅根据 `space_id` 跳转路由，实际HTML内容的获取和展示依赖于跳转后的页面逻辑或需要进一步明确。

*   **中文内容考量:**
    *   **UI文本:** 目前全部为英文硬编码。需要引入i18n方案进行翻译。
    *   **AI提示词:** 用户可以用中文输入提示，但系统提示词是英文的。为获得最佳效果，应提供中文版系统提示词。
    *   **AI生成内容中的中文:** AI模型本身需要具备良好的中文理解和生成能力，才能在代码的文本内容（如按钮文字、段落）中正确使用中文。
    *   **字符编码:** 整个链路（前端输入、HTTP传输、后端处理、AI模型、数据库存储）必须统一使用UTF-8编码，以正确处理中文字符。
    *   **`SEARCH/REPLACE`的精确性:** 对于包含中文内容的HTML，AI生成的搜索块必须能精确匹配，后端解析也需正确处理中文。

## 4. 项目管理（保存/加载）

*   **数据模型 (`models/Project.ts`):**
    *   MongoDB中的 `Project` Schema包含 `space_id` (必需, Hugging Face Space的路径), `user_id` (必需), `prompts` (AI提示历史), 时间戳。
    *   **关键：不直接存储HTML代码。**

*   **保存/创建新项目 (`app/api/me/projects/route.ts` - `POST`):**
    1.  用户在前端（推测通过 `DeployButton`）触发。
    2.  前端发送 `title`, `html`, `prompts` 到后端。
    3.  后端：
        *   认证用户。
        *   使用 `@huggingface/hub` 的 `createRepo` 在用户的Hugging Face账户下创建一个新的Space。
        *   生成 `README.md` (包含Space元数据)。
        *   **将用户提供的 `html` 内容写入 `index.html` 文件。** (会稍微修改HTML，插入一个返回Space的链接)
        *   使用 `uploadFiles` 将 `index.html` 和 `README.md` 上传到创建的Space。
        *   在MongoDB中创建 `Project` 文档，保存 `user_id`, `space_id` (新创建的Space路径), 和 `prompts`。
    4.  返回创建的项目信息。

*   **加载项目 (`app/api/me/projects/route.ts` - `GET`):**
    1.  前端（推测通过 `LoadProject` 组件）请求此API。
    2.  后端认证用户，从MongoDB查询该用户的项目列表（基于 `user_id`），返回项目元数据（包含 `space_id`）。
    3.  前端 `LoadProject` 组件的 `onSuccess` 回调接收到项目列表后，如果用户选择加载某个项目，目前观察到的行为是使用 `router.push(`/projects/${project.space_id}`);` 进行页面跳转。
    4.  **HTML内容的实际加载：** 理论上，在跳转到 `/projects/[namespace]/[repoId]` 页面后，该页面组件需要负责从Hugging Face Space（使用 `space_id` 作为标识）获取 `index.html` 的内容并将其填充到编辑器中。这部分逻辑在当前已分析的文件中未直接体现，需要查看对应的页面文件。

## 5. 国际化（I18n）与中文支持

### UI翻译的现状与计划

*   **现状:**
    *   **几乎没有国际化支持。**
    *   `app/layout.tsx` 中 `<html>` 标签硬编码 `lang="en"`。
    *   所有UI文本（按钮、标签、提示、错误信息等）均为英文硬编码在JSX中。
    *   未引入任何i18n库 (如 `next-i18next`, `react-i18next`)。
    *   无语言资源文件。

*   **计划 (初步):**
    1.  **选择并集成i18n框架:** 如 `next-i18next`。
    2.  **修改 `app/layout.tsx`:** 动态设置 `lang` 属性。
    3.  **创建语言文件:** 至少 `public/locales/en/common.json` 和 `public/locales/zh/common.json`。
    4.  **提取字符串:** 遍历UI组件，将硬编码的英文字符串替换为翻译函数的调用 (如 `t('key')`)，并在语言文件中添加对应键值。
    5.  **配置i18n:** 根据所选框架文档进行初始化和配置。
    6.  **(可选) 实现语言切换器。**

### 后端和数据库处理中文字符

*   **Next.js API路由:** 默认情况下，Node.js和Next.js能良好处理UTF-8编码的请求和响应体，只要客户端正确发送编码（现代浏览器通常默认UTF-8）。
*   **MongoDB & Mongoose:** MongoDB本身支持UTF-8存储。Mongoose作为ODM也会正确处理JavaScript字符串到MongoDB的UTF-8存储。
*   **AI模型交互:**
    *   发送给AI的提示（如果包含中文）和从AI接收的内容（如果AI生成了中文）在HTTP传输时需要确保是UTF-8编码。`@huggingface/inference` 和底层的HTTP客户端通常能处理好。
    *   系统提示词目前是英文，若要支持中文，需要提供翻译版本。
*   **潜在风险点:** 文件读写（如果未来涉及本地文件操作而非仅Hugging Face Spaces）需要确保使用UTF-8编码。

## 6. 针对用户需求的分析总结

### 关于Langchain的确认

*   **本项目目前没有使用Langchain或任何类似的AI应用编排框架。** AI模型的调用是直接通过 `@huggingface/inference` SDK进行的。

### AI交互点通用化评估

*   **当前耦合点:**
    *   AI调用逻辑强依赖 `@huggingface/inference` 客户端。
    *   Provider和模型的选择与配置 (`lib/providers.ts`) 是针对Hugging Face生态的。
    *   API Token (`HF_TOKEN`, `DEFAULT_HF_TOKEN`) 是Hugging Face的Token。
    *   `billTo` 参数是Hugging Face特有的。
*   **改造方向 (已在计划中详述):**
    1.  **定义通用AI服务接口:** 例如 `interface AIService { chatCompletion(options: ChatOptions): Promise<Response>; }`。
    2.  **创建适配器 (Adapters):**
        *   `HuggingFaceAdapter`: 实现 `AIService` 接口，封装现有使用 `@huggingface/inference` 的逻辑。
        *   `OpenAICompatibleAdapter`: 实现 `AIService` 接口，使用 `fetch` 或 `axios` 调用任何OpenAI兼容的API端点。接收 `apiKey`, `baseUrl`, `modelName` 等参数。
    3.  **修改后端API (`/api/ask-ai`):** 根据前端传递的 `providerName` (如 "openai", "gemini", "huggingface") 和相关配置（API Key, Base URL等）动态选择并实例化相应的适配器。
    4.  **更新前端设置:** 允许用户选择AI提供商，并输入相应的API Key, Base URL, 模型名称等。

### 单页生成逻辑改造以支持多文件项目

*   **当前限制因素:**
    *   `INITIAL_SYSTEM_PROMPT` 中的 `ALWAYS GIVE THE RESPONSE INTO A SINGLE HTML FILE` 指令。
    *   `FOLLOW_UP_SYSTEM_PROMPT` 的设计也是基于修改单个HTML文件。
    *   前端状态管理 (`useEditor` 的 `html` 字段) 只处理单个HTML字符串。
    *   预览组件 (`Preview`) 通过 `srcDoc` 直接渲染单个HTML字符串。
    *   项目保存机制 (`app/api/me/projects/route.ts` 的 `POST` 方法) 将单个HTML内容保存为Hugging Face Space上的 `index.html`。
*   **改造方向 (已在计划中详述):**
    1.  **修改系统提示词:**
        *   新的 `INITIAL_SYSTEM_PROMPT` 需要指示AI生成一个项目结构，例如以JSON格式返回多个文件及其内容：`{ "index.html": "...", "style.css": "...", "script.js": "..." }`。并指明主入口文件。
        *   新的 `FOLLOW_UP_SYSTEM_PROMPT` 需要能处理对特定文件的修改，AI的响应中可能需要包含文件名。
    2.  **更新后端API (`/api/ask-ai`):**
        *   能够解析AI返回的多文件JSON结构。
        *   流式处理可能需要调整为先接收完整JSON结构，或分文件流式传输（更复杂）。
    3.  **修改前端状态管理 (`hooks/useEditor.ts`):**
        *   将单一 `html` 字符串状态改为管理一个文件对象集合，如 `files: Record<string, string>` (文件名到文件内容的映射)。
        *   增加当前活动/编辑的文件状态。
    4.  **更新Monaco Editor集成:**
        *   实现文件浏览器/标签页，允许用户切换和编辑不同的文件。
        *   Monaco Editor加载活动文件的内容。
    5.  **增强预览功能:**
        *   不能再简单使用 `srcDoc`。
        *   **方案1 (客户端Blob URLs):** 为每个文件创建Blob URL，在主HTML文件中重写相对路径为这些Blob URL，然后加载主HTML的Blob URL到iframe。
        *   **方案2 (服务器端预览沙箱):** (更复杂，但更健壮) 创建一个临时API端点，接收文件结构，在服务器上临时存储并提供这些文件，iframe指向此端点。
    6.  **更新项目保存/加载:**
        *   MongoDB中的 `Project` 模型需要能存储整个文件结构 (例如，一个大的JSON字段，或者如果采用服务器端存储，则存储文件路径引用)。
        *   Hugging Face Spaces的部署逻辑也需要改为上传多个文件。

---
此文档总结了对DeepSite项目当前状态的分析。后续的改造工作将基于此分析进行。
