# GPT Checkout Studio

一个本地优先的 React + Vite 工具：粘贴已获授权的 ChatGPT session，选择账单国家与订阅档位，然后复用相邻 GPT-Register-Tool 中经过验证的 Checkout 提取器生成托管结账链接。

## 安全边界

- Session 只从浏览器发送给本机 Vite 服务，不会写入浏览器持久化存储。
- 凭证只写入权限受限的系统临时文件，提取器退出后立即删除。
- 请求使用 `curl_cffi` 的 Chrome 136 指纹、Cookie Jar、设备 ID 与代理出口校验。
- Access token、Cookie 和代理密码不会写入业务日志。
- 只创建结账链接，不保存银行卡信息，也不会自动付款。
- Vite 仅监听 127.0.0.1，API 同时校验本机 Host 与 Origin。

> 这是非官方本地工具，依赖 ChatGPT Web 内部结账流程。内部接口和套餐标识可能更新，请以最终结账页显示的套餐、币种和金额为准。

默认配置：

- 提取器：`../GPT-Register-Tool/services/protocol-payment/direct_card/direct_card_extract.py`
- Python：`../GPT-Register-Tool/.venv/Scripts/python.exe`
- Clash 代理：`http://127.0.0.1:7890`

如果路径或代理端口不同，复制 `.env.example` 为 `.env.local` 后修改并重启 Vite。

> 普通 Node/Vite HTTPS 转发虽然能解决 CORS，但无法复现 Chrome TLS/HTTP2 指纹，容易触发 unusual activity 或 Cloudflare 校验。本项目因此复用参考项目的 `curl_cffi impersonate=chrome136` 请求链。

## 启动

```powershell
cd G:\EnglishProgram\AI\gpt-checkout-studio
pnpm install
pnpm dev
```

浏览器打开 `http://127.0.0.1:5173`。

## 使用

1. 在 Clash 中切换到目标国家节点，保持系统代理开启。
2. 在输入框粘贴完整 session JSON 或单独的 access token，页面会自动提取。JSON 需要包含 `accessToken` 或 `access_token`。
3. 选择与代理出口一致的国家；币种会自动匹配。
4. 选择 Plus、Pro Lite 或 Pro，勾选授权确认后生成链接。
5. 打开托管结账页，再次核对套餐、金额与币种后自行完成支付。

## 完整链路

1. React 前端
2. → Vite 本地接口 /api/create-checkout
3. → 启动本地 Python direct_card_extract.py
4. → curl_cffi 模拟 Chrome 136
5. → 通过 Clash 代理
6. → https://chatgpt.com/backend-api/payments/checkout

## 常见错误

- `Billing country must match request country`：代理实际出口国家与所选账单国家不一致。
- `payment_proxy_pool_unavailable`：代理无法访问支付上游，或代理节点不适合该地区。
- `401`：session 已失效，需要重新导出。
- 提取服务异常：确认参考项目的 `.venv` 存在并已安装 `curl_cffi`，或设置正确的 `GPT_CHECKOUT_PYTHON`。
- `unusual activity`：优先使用同一次登录导出的完整 Session/Cookie，并保持账号、账单国家和代理出口一致。
- Cloudflare 403：确认代理节点可用，避免高频重试。

本项目不会开启 0 元促销或 0 元金额校验；生成的是所选正常订阅档位的托管结账链接。
