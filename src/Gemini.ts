import { GoogleGenerativeAI } from '@google/generative-ai';
import { QuizData } from './types.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
});

export const generateQuiz = async (prefecture: string): Promise<QuizData> => {
    const prompt = `
    都道府県「${prefecture}」に関する、非常にマニアックな3択クイズを1問作成してください。
    地元民でも正解率が低い、歴史・地理・文化・ニッチな統計などから出題してください。
    以下のJSON形式で出力してください：
    { "question": string, "options": string[], "answerIndex": number, "explanation": string }
  `;

    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
};
