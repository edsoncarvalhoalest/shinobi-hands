# 🥷 Shinobi Hands — Reconhecimento de Selos & Jutsus (Naruto)

Motor de visão computacional em tempo real no navegador inspirado na arquitetura de gestos do **Jarvis for Builders**, focado em reconhecer **Selos de Mão de Naruto (Hand Seals / 印)** com as **2 mãos unidas (42 pontos 3D + cinemática dos antebraços)** e disparar **Jutsus** em um modo guiado estilo **Just Dance + Xbox Kinect**.

---

## ✨ Principais Funcionalidades (V1.4)

- **🕺 Modo Just Dance Shinobi + Xbox Kinect Assist (`kinectAssist.ts`)**:
  - Exibe o **Jutsu Desafio da Vez** e a esteira coreográfica passo-a-passo (`PASSO 1`, `PASSO 2`, `PASSO 3`...).
  - O motor aplica **assistência inteligente de intenção** focada no selo atual da sequência (`✨ PERFECT!`, `🔥 GREAT!`, `👍 GOOD!`), ajudando contra pequenas oclusões de câmera e impedindo que selos acidentais quebrem o combo durante a transição das mãos.
  - **Gate de Movimento e Separação (`HandMotionResetGate`)**: exige que o jogador separe ou mova as mãos entre um selo e outro, impedindo pontuações falsas com as mãos paradas.
- **👐 Fusão Dual-Hand de Mãos Unidas & Cinemática dos Braços (`sealClassifier.ts`)**:
  - Detecta até **2 mãos simultaneamente (42 landmarks 3D)** a **60 FPS** via `@mediapipe/tasks-vision` (WebGL/WASM).
  - Resolve oclusão de dedos entrelaçados (como no selo **Tigre / Tora**) combinando elevação vertical ($\Delta y$), vetores radiais para a cruz (`+`) do **Clone (`Bunshin`)** e ângulos de inclinação dos antebraços ($\theta_{\text{esq}}, \theta_{\text{dir}}$).
- **🎯 Calibrador Híbrido Few-Shot (`hybridCalibrator.ts`)**:
  - Permite gravar em 1,5s a assinatura exata das suas próprias mãos unidas (vetor 3D normalizado + silhueta visual 8×8 da zona de união) direto no `localStorage`.
- **⚡ 7 Selos Fundamentais**:
  1. 🐯 **Tigre (`Tora` / 寅)**: Mãos conectadas com Indicadores + Médios unidos apontando para cima.
  2. 🐍 **Serpente (`Mi` / 巳)**: Mãos unidas com todos os dedos entrelaçados/fechados.
  3. 🐦 **Pássaro (`Tori` / 酉)**: Mãos conectadas com Indicadores + Mínimos erguidos.
  4. 🐏 **Bode (`Hitsuji` / 未)**: Mãos sobrepostas com 3 dedos erguidos (Indicador + Médio + Anelar).
  5. 🐗 **Javali (`I` / 亥)**: Palmas conectadas com os 5 dedos abertos.
  6. 🐕 **Cavalo / Cachorro (`Inu` / 戌)**: Indicadores unidos formando um triângulo (`/\`).
  7. 🥷 **Clone (`Bunshin` / 壬)**: Cruz Ninja (`+`) com Indicador + Médio das duas mãos cruzados.
- **🔥 Grimório de Jutsus**:
  - **Kage Bunshin no Jutsu**: `Clone → Serpente → Tigre`
  - **Katon: Gōkakyū no Jutsu (Bola de Fogo)**: `Serpente → Bode → Javali → Tigre`
  - **Chidori (Mil Pássaros)**: `Cavalo/Cachorro → Serpente → Pássaro`
  - **Rasengan**: `Serpente → Javali`
  - **Suiton: Suiryūdan no Jutsu (Dragão de Água)**: `Pássaro → Bode → Serpente → Tigre`

---

## 🚀 Como Clonar e Jogar

```bash
npm install
npm run dev
```

Para rodar a suíte de testes automatizados (`vitest`) e validar o build de produção:

```bash
npm test
npm run build
```
