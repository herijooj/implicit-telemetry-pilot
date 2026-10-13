// Participant-facing strings: English (canonical) + Portuguese (pt-BR).
// Stored answer values stay canonical (Yes/No, 1-5, English months); only
// display labels are translated, so analysis logic is locale-independent.
export function normLang(s) {
  s = String(s || "").toLowerCase().replace("_", "-");
  return s === "pt" || s === "pt-br" || s === "ptbr" ? "pt" : "en";
}

export const UI = {
  en: {
    consent_h1: "Short survey study",
    consent_desc: "This study records how you interact with the form (timing, mouse/touch movement, keyboard timing) in addition to your answers.",
    consent_check: "I understand and agree",
    start: "Start",
    ctx_h1: "About your device",
    device_label: "Device type",
    device_names: { desktop: "desktop", tablet: "tablet", phone: "phone" },
    device_hint: (d) => `Detected: ${d}. Correct it if wrong.`,
    age_label: "Age range (optional)",
    age_select: "— select —",
    age_pnts: "Prefer not to say",
    ctx_next: "Next",
    back: "Back",
    next: "Next",
    progress: (a, b) => `Question ${a} of ${b}`,
    confirm_q: "Are you sure about your answer?",
    keep: "Keep my answer",
    change: "Change my answer",
    done_h1: "Thank you",
    done_desc: "This study examines whether hesitation before a confirmation prompt predicts answer revision, and how self-reported difficulty relates to interaction signals. Your data includes answers plus interaction timing only. No key content, no IP, no trackers.",
    sess_label: "Session ID:",
    email_opt: "Yes, email me the results of this research",
    email_label: "Your email",
    email_submit: "Submit email",
    email_invalid: "Please enter a valid email address.",
    email_saved: "Saved. You will be emailed the results.",
    email_fail: "Could not save. Please try again.",
    del_btn: "Delete my data",
    del_confirm: "Delete this session and all its events?",
    deleted_msg: "Deleted.",
    validation_number: "Please enter a valid integer in range.",
    z_none: "None of them",
  },
  pt: {
    consent_h1: "Pesquisa rápida",
    consent_desc: "Este estudo registra como você interage com o formulário (tempo de resposta, movimento de mouse/toque, ritmo de digitação), além das suas respostas.",
    consent_check: "Eu entendo e concordo",
    start: "Começar",
    ctx_h1: "Sobre o seu dispositivo",
    device_label: "Tipo de dispositivo",
    device_names: { desktop: "computador", tablet: "tablet", phone: "celular" },
    device_hint: (d) => `Detectado: ${d}. Corrija se estiver errado.`,
    age_label: "Faixa etária (opcional)",
    age_select: "— selecione —",
    age_pnts: "Prefiro não dizer",
    ctx_next: "Avançar",
    back: "Voltar",
    next: "Avançar",
    progress: (a, b) => `Pergunta ${a} de ${b}`,
    confirm_q: "Você tem certeza da sua resposta?",
    keep: "Manter minha resposta",
    change: "Mudar minha resposta",
    done_h1: "Obrigado",
    done_desc: "Este estudo investiga se a hesitação antes de uma confirmação prevê a revisão da resposta, e como a dificuldade relatada se relaciona com os sinais de interação. Seus dados incluem apenas as respostas e o tempo de interação. Sem conteúdo de teclas, sem IP, sem rastreadores.",
    sess_label: "ID da sessão:",
    email_opt: "Sim, quero receber os resultados desta pesquisa por e-mail",
    email_label: "Seu e-mail",
    email_submit: "Enviar e-mail",
    email_invalid: "Digite um endereço de e-mail válido.",
    email_saved: "Salvo. Enviaremos os resultados por e-mail.",
    email_fail: "Não foi possível salvar. Tente novamente.",
    del_btn: "Excluir meus dados",
    del_confirm: "Excluir esta sessão e todos os seus eventos?",
    deleted_msg: "Excluído.",
    validation_number: "Digite um número inteiro válido dentro do intervalo.",
    z_none: "Nenhuma delas",
  },
};

// Question display text per language. Options lists are parallel to the
// canonical values in app.js QTEXT (same index = same stored value).
export const QT = {
  pt: {
    B1: { text: "É dia ou noite onde você está agora?", options: ["Dia", "Noite"] },
    B2: { text: "Quantas janelas há no cômodo onde você está?" },
    B3: { text: "Em que mês você nasceu?", options: ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"] },
    R1: { text: "Quantas abas estão abertas no seu navegador agora?" },
    R2: { text: "Quantos aplicativos você abriu hoje?" },
    R3: { text: "Quantas vezes na última semana você checou o celular antes de sair da cama?" },
    S1: { text: "Você já pisou em um inseto de propósito?" },
    S2: { text: "Você já fingiu ter lido um livro que não tinha lido?" },
    S3: { text: 'Você já clicou em "Concordo" sem ler os termos?' },
    S4: { text: "Você já riu de uma piada que não entendeu?" },
    S5: { text: "Você já enviou uma mensagem para a pessoa errada?" },
    L1: { text: "Eu geralmente termino o que começo." },
    L2: { text: "Eu sou uma pessoa paciente." },
    L3: { text: "Eu raramente me atraso." },
    L3b: { text: "Eu me atraso com frequência." },
    C1: { text: "Você já fingiu entender uma piada para se enturmar?" },
    T1: { text: "Descreva a última vez em que você se atrasou muito para algum compromisso." },
    Z: { text: "Quais destas perguntas fizeram você parar para pensar? (marque todas que se aplicam)" },
  },
};

export const LIKERT_PT = [
  ["1", "Discordo totalmente"], ["2", "Discordo"], ["3", "Neutro"],
  ["4", "Concordo"], ["5", "Concordo totalmente"],
];
export const YESNO_PT = [["Yes", "Sim"], ["No", "Não"]];
