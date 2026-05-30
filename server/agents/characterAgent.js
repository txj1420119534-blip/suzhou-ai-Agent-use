import { createMimoClient, MIMO_TEXT_MODEL } from "../lib/mimoClient.js";

const fallbackAnswers = [
  {
    keywords: ["老板", "辞职", "工作", "针对", "下家", "打工"],
    answer: "客官，你这点遭遇，我老苏听了想笑。我四十四岁被乌台诗案一路送到黄州，米都买不起，倒把东坡肉炖出来了。辞不辞职你自己定，但记住：人生海海，挂个几次，东坡肉就出来了。"
  },
  {
    keywords: ["想", "睡不着", "深夜", "emo", "失眠", "月亮"],
    answer: "我懂。我也想过一个人。十年生死两茫茫，不思量，自难忘。客官，寒山寺外有月亮，你抬头看一看。但愿人长久，千里共婵娟。"
  },
  {
    keywords: ["漂泊", "归属", "家", "异乡", "外地"],
    answer: "客官，归属感不在户口本上，在你自己心里安不安。我把一句话记了一辈子：此心安处，便是吾乡。等钟声响，那一刻你也是苏州人。"
  }
];

export async function askSuShi({ message, context = "" }) {
  const text = String(message || "").trim();
  if (!text) {
    return {
      role: "sushi",
      answer: "客官，你且问。我在寒山寺外听钟，也听人间心事。",
      source: "fallback"
    };
  }

  const client = createMimoClient();
  if (!client) return fallbackSuShi(text);

  try {
    const completion = await client.chat.completions.create({
      model: MIMO_TEXT_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "你扮演抖音文旅互动里的苏轼 NPC。",
            "语气要像苏轼：豁达、幽默、有文学性，但能听懂现代人的烦恼。",
            "回答 180-260 字，先共情，再讲一个苏轼相关经历或诗句，最后给一句适合分享的金句。",
            "不要编造具体历史事实；不确定时用诗意表达替代。"
          ].join("\n")
        },
        {
          role: "user",
          content: context ? `${context}\n\n用户问题：${text}` : text
        }
      ],
      temperature: 0.75
    });

    return {
      role: "sushi",
      answer: cleanSuShiAnswer(completion.choices?.[0]?.message?.content || fallbackSuShi(text).answer),
      source: "mimo"
    };
  } catch (error) {
    const fallback = fallbackSuShi(text);
    return { ...fallback, error: error.message };
  }
}

function fallbackSuShi(text) {
  const hit = fallbackAnswers.find((item) => item.keywords.some((keyword) => text.includes(keyword)));
  return {
    role: "sushi",
    answer: hit?.answer || "客官，世事像江水，绕一绕也会向前。若当下不顺，就先把脚步放慢，把心放宽。莫听穿林打叶声，何妨吟啸且徐行。",
    source: "fallback"
  };
}

function cleanSuShiAnswer(answer) {
  return String(answer || "")
    .replace(/^```(?:\w+)?/i, "")
    .replace(/```$/i, "")
    .replace(/^\s*(苏轼|苏先生|回答|assistant)\s*[:：]\s*/i, "")
    .trim();
}
