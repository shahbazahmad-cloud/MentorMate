import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, LiveServerMessage, Modality } from "@google/genai";
import dotenv from "dotenv";
import http from "http";
import { WebSocketServer } from "ws";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { message, pdfDataUrl, currentPage } = req.body;
    let parts: any[] = [];
    if (pdfDataUrl) {
       parts.push({
           inlineData: {
               mimeType: "application/pdf",
               data: pdfDataUrl.split(',')[1]
           }
       });
       if (currentPage) {
           parts.push({ text: `The user is currently reading page ${currentPage} of the PDF.` });
       }
    }
    parts.push({ text: message });

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let responseStream;
    try {
      responseStream = await ai.models.generateContentStream({
        model: "gemini-3.5-flash",
        contents: { parts },
        config: {
          systemInstruction: "You are MentorMate AI. Provide accurate, helpful, and concise answers to complex questions, directly related to the user's PDF and query without any filler. Avoid being too short; ensure the user understands the topic deeply.",
          tools: [{ googleSearch: {} }],
        },
      });
    } catch (errStream1) {
      console.warn("First model attempt failed, trying fallback model gemini-3.1-flash-lite...", errStream1);
      try {
        responseStream = await ai.models.generateContentStream({
          model: "gemini-3.1-flash-lite",
          contents: { parts },
          config: {
            systemInstruction: "You are MentorMate AI. Provide accurate, helpful, and concise answers to complex questions, directly related to the user's PDF and query without any filler. Avoid being too short; ensure the user understands the topic deeply.",
            tools: [{ googleSearch: {} }],
          },
        });
      } catch (errStream2) {
        console.warn("Second model attempt failed, trying fallback model gemini-2.5-flash...", errStream2);
        responseStream = await ai.models.generateContentStream({
          model: "gemini-2.5-flash",
          contents: { parts },
          config: {
            systemInstruction: "You are MentorMate AI. Provide accurate, helpful, and concise answers to complex questions, directly related to the user's PDF and query without any filler. Avoid being too short; ensure the user understands the topic deeply.",
            tools: [{ googleSearch: {} }],
          },
        });
      }
    }

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error("Chat error:", error);
    if (!res.headersSent) {
      res.status(error.status || 500).json({ error: error.message || "Failed to communicate with AI." });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message || "Failed to communicate with AI." })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/gemini/generate-notes", async (req, res) => {
  try {
    const { syllabus, links, fileDataUrls } = req.body;
    
    let parts: any[] = [];
    if (syllabus) {
      parts.push({ text: `Syllabus:\n${syllabus}` });
    }
    if (links) {
      parts.push({ text: `Relevant Links:\n${links}` });
    }
    if (fileDataUrls && Array.isArray(fileDataUrls)) {
      for (const dataUrl of fileDataUrls) {
        if (dataUrl.includes('application/pdf')) {
	  // pass pdf part
          parts.push({ inlineData: { mimeType: "application/pdf", data: dataUrl.split(',')[1] }});
        }
      }
    }
    
    parts.push({ 
      text: `Analyze the provided syllabus, links, and documents. Generate comprehensive, highly structured academic study notes in Markdown format.
CRITICAL RULES:
1. Provide ONLY the notes. No conversational preamble, greetings, or explanations (e.g., do NOT start with "Sure! Here is...", "Here is the notes based on...", or "As requested...").
2. No postambles, summaries, or conversational concluding sentences at the end (e.g., do NOT end with "Hope this helps!", "Let me know if you need...", or "Good luck!").
3. Start immediately with the main note title as a Heading 1 (e.g. "# [Topic] Core Study Notes").
4. Organize the content beautifully using nested bullet points, bold keywords, clearly delineated definitions, side-by-side conceptual tables, and clear Headings (H1, H2, H3) to map out all concepts comprehensively.` 
    });

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: { parts },
        config: {
          systemInstruction: "You are a professional study notes generator. Generate comprehensive, beautifully structured academic notes. Strictly start directly with the title of the notes or the first section. Do NOT write any conversational preamble, introductions, metadata acknowledgments, or postambles (e.g., do NOT start with 'Here are the notes based on...' or end with 'Let me know if you need more...'). Proceed directly to the generated content. Format using rich Markdown."
        }
      });
    } catch (errGen1) {
      console.warn("First model attempt for notes failed, trying fallback gemini-3.1-flash-lite...", errGen1);
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: { parts },
          config: {
            systemInstruction: "You are a professional study notes generator. Generate comprehensive, beautifully structured academic notes. Strictly start directly with the title of the notes or the first section. Do NOT write any conversational preamble, introductions, metadata acknowledgments, or postambles. Proceed directly to the generated content. Format using rich Markdown."
          }
        });
      } catch (errGen2) {
        console.warn("Second model attempt for notes failed, trying fallback gemini-2.5-flash...", errGen2);
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: { parts },
          config: {
            systemInstruction: "You are a professional study notes generator. Generate comprehensive, beautifully structured academic notes. Strictly start directly with the title of the notes or the first section. Do NOT write any conversational preamble, introductions, metadata acknowledgments, or postambles. Proceed directly to the generated content. Format using rich Markdown."
          }
        });
      }
    }

    res.json({ text: response.text });
  } catch (error: any) {
    console.error("Notes generation error:", error);
    res.status(error.status || 500).json({ error: error.message || "Failed to generate notes. The AI service might be busy." });
  }
});

app.post("/api/gemini/study-plan", async (req, res) => {
  try {
    const { pdfName, firstPageText } = req.body;
    
    const prompt = `Analyze the document name: "${pdfName || 'Study Material'}" and its first page content snippet:
"${firstPageText || ''}"

Based on this content context, formulate a structured learning/study plan containing exactly 5 sequential phases or milestones for a student studying this file.

Return the result STRICTLY as a valid JSON object matching this schema:
{
  "estimatedHours": number, // e.g., 10
  "difficulty": "Beginner" | "Intermediate" | "Advanced",
  "milestones": [
    {
      "id": 1,
      "title": "Milestone Title",
      "description": "Milestone Description detailing what they will learn",
      "duration": "Estimated time (e.g. 2 hours)",
      "keyTopics": ["Topic A", "Topic B"]
    }
  ]
}

Ensure you only return valid parseable JSON. Do not write markdown blocks or backticks in your response.`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json"
        }
      });
    } catch (errPlan1) {
      console.warn("First model attempt for plan failed, trying fallback gemini-3.1-flash-lite...", errPlan1);
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: [{ text: prompt }],
          config: {
            responseMimeType: "application/json"
          }
        });
      } catch (errPlan2) {
        console.warn("Second model attempt for plan failed, trying fallback gemini-2.5-flash...", errPlan2);
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ text: prompt }],
          config: {
            responseMimeType: "application/json"
          }
        });
      }
    }

    const text = response.text || "{}";
    const plan = JSON.parse(text.trim());
    res.json(plan);
  } catch (error: any) {
    console.error("Study plan generation error:", error);
    // Provide a neat fallback structure in case the AI limit / key is missing or fails
    res.json({
      estimatedHours: 8,
      difficulty: "Intermediate",
      milestones: [
        { id: 1, title: "Overview & Context", description: "Get familiar with the main subjects and structure of this study document.", duration: "1.5 hours", keyTopics: ["Structure scan", "Objective listing"] },
        { id: 2, title: "Core Terminology", description: "Learn key glossary words, main frameworks, and basic definitions.", duration: "1.5 hours", keyTopics: ["Glossary definitions", "Core frameworks"] },
        { id: 3, title: "In-Depth Study", description: "Deep dive into main equations, code, or chapter materials using interactive chat queries.", duration: "2.5 hours", keyTopics: ["Detailed review", "Discussion turns"] },
        { id: 4, title: "Active Recall Activities", description: "Practice quiz-taking, active synthesis, and flashcard style prompts with MentorMate.", duration: "1.5 hours", keyTopics: ["Self quiz", "Summarization"] },
        { id: 5, title: "Final Review & Reflection", description: "Reflect on learned milestones, consolidate gaps, and plan next execution blocks.", duration: "1 hour", keyTopics: ["Knowledge gaps", "Comprehensive exam ready"] }
      ]
    });
  }
});

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", async (clientWs) => {
    let sessionPromise: any = null;
    let voiceName: "Puck" | "Kore" | "Zephyr" | "Charon" | "Fenrir" = "Zephyr";

    clientWs.on("message", async (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        // Handle initialization
        if (parsed.type === "init") {
           // We can pass context here
           voiceName = parsed.voice === "brit" ? "Kore" : "Zephyr";
           
           sessionPromise = ai.live.connect({
            model: "gemini-3.1-flash-live-preview",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName } },
              },
              systemInstruction: `You are MentorMate AI. Provide accurate, helpful, and concise answers to complex questions. You are having a real-time voice conversation with the user. IMPORTANT: At the beginning of the live conversation, you MUST greet the user with: "Hii, which topic would you like to study today?" ${parsed.context || ''}`,
              inputAudioTranscription: {},
              outputAudioTranscription: {}
            },
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                if (message.serverContent?.modelTurn?.parts) {
                    message.serverContent.modelTurn.parts.forEach((p: any) => {
                        if (p.inlineData && p.inlineData.data) {
                            clientWs.send(JSON.stringify({ audio: p.inlineData.data }));
                        }
                    });
                }
                
                // Remove massive base64 audio payload from rawMessage before sending
                const cleanMessage = JSON.parse(JSON.stringify(message));
                if (cleanMessage.serverContent?.modelTurn?.parts) {
                    cleanMessage.serverContent.modelTurn.parts = cleanMessage.serverContent.modelTurn.parts.map((p: any) => {
                        if (p.inlineData) {
                            return { inlineData: { mimeType: p.inlineData.mimeType, data: "" } };
                        }
                        return p;
                    });
                }
                
                clientWs.send(JSON.stringify({ rawMessage: cleanMessage }));
                
                if (message.serverContent?.interrupted) {
                  clientWs.send(JSON.stringify({ interrupted: true }));
                }
              },
            },
          });

          sessionPromise.then(async (session: any) => {
            try {
              await session.sendClientContent({
                turns: [
                  {
                    role: 'user',
                    parts: [{ text: 'Hello! Please start the conversation now with your opening question.' }]
                  }
                ],
                turnComplete: true
              });
            } catch (err) {
              console.error("Error triggering initial greeting:", err);
            }
          });
        }
        
        // Handle Audio
        if (parsed.audio && sessionPromise) {
          const session = await sessionPromise;
          session.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
          });
        }

        // Handle user text via Live API
        if (parsed.type === "text" && sessionPromise) {
           const session = await sessionPromise;
           session.sendClientContent({ 
               turns: [ { role: 'user', parts: [{ text: parsed.text }] } ],
               turnComplete: true 
           });
        }
        
        // Handle page image frame
        if (parsed.type === "page_image" && sessionPromise) {
           const session = await sessionPromise;
           session.sendRealtimeInput({
              video: { data: parsed.image, mimeType: parsed.mimeType }
           });
        }
      } catch (e) {
        console.error("Live API Error:", e);
      }
    });
    
    clientWs.on("close", () => {
        if (sessionPromise) {
           sessionPromise.then((session: any) => session.close()).catch(console.error);
        }
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
