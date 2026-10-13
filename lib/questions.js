// Static question bank per spec §4.
export const QUESTIONS = {
  B1: { text: "Is it currently day or night where you are?", type: "radio", options: ["Day", "Night"] },
  B2: { text: "How many windows are in the room you're in?", type: "number", min: 0, max: 50 },
  B3: { text: "Which month were you born in?", type: "dropdown", options: ["January","February","March","April","May","June","July","August","September","October","November","December"] },
  R1: { text: "How many tabs are open in your browser right now?", type: "number", min: 0, max: 999 },
  R2: { text: "How many apps have you opened today?", type: "number", min: 0, max: 999 },
  R3: { text: "How many times last week did you check your phone before getting out of bed?", type: "number", min: 0, max: 99 },
  S1: { text: "Have you ever stepped on a bug on purpose?", type: "yesno", flagged: true },
  S2: { text: "Have you ever pretended to have read a book you hadn't?", type: "yesno", flagged: true },
  S3: { text: 'Have you ever clicked "I agree" without reading the terms?', type: "yesno", flagged: true },
  S4: { text: "Have you ever laughed at a joke you didn't understand?", type: "yesno", flagged: true },
  S5: { text: "Have you ever sent a message to the wrong person?", type: "yesno", flagged: true },
  L1: { text: "I usually finish what I start.", type: "likert5" },
  L2: { text: "I am a patient person.", type: "likert5" },
  L3: { text: "I am rarely late.", type: "likert5" },
  L3b:{ text: "I am often late.", type: "likert5" },
  C1: { text: "Have you ever pretended to get a joke to fit in?", type: "yesno" },
  T1: { text: "Describe the last time you were really late for something.", type: "text", minLen: 1, maxLen: 1000 },
  Z:  { text: "Which of these questions made you stop and think? (select all that apply)", type: "multiselect" },
};
export const FLAGGED = ["S1", "S2", "S3", "S4", "S5"];
export const BASELINE = ["B1", "B2", "B3"];
