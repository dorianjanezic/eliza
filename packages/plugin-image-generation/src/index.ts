import { elizaLogger } from "@ai16z/eliza";
import {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    Plugin,
    State,
} from "@ai16z/eliza";
import { generateCaption, generateImage } from "@ai16z/eliza";

import fs from "fs";
import path from "path";

export function saveBase64Image(base64Data: string, filename: string): string {
    // Create generatedImages directory if it doesn't exist
    const imageDir = path.join(process.cwd(), "generatedImages");
    if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
    }

    // Remove the data:image/png;base64 prefix if it exists
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, "");

    // Create a buffer from the base64 string
    const imageBuffer = Buffer.from(base64Image, "base64");

    // Create full file path
    const filepath = path.join(imageDir, `${filename}.png`);

    // Save the file
    fs.writeFileSync(filepath, imageBuffer);

    return filepath;
}

export async function saveHeuristImage(
    imageUrl: string,
    filename: string
): Promise<string> {
    const imageDir = path.join(process.cwd(), "generatedImages");
    if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
    }

    // Fetch image from URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    // Create full file path
    const filepath = path.join(imageDir, `${filename}.png`);

    // Save the file
    fs.writeFileSync(filepath, imageBuffer);

    return filepath;
}

const imageGeneration: Action = {
    name: "GENERATE_IMAGE",
    similes: [
        "IMAGE_GENERATION",
        "IMAGE_GEN",
        "CREATE_IMAGE",
        "MAKE_PICTURE",
        "GENERATE_IMAGE",
        "GENERATE_A",
        "DRAW",
        "DRAW_A",
        "MAKE_A",
    ],
    description: "Generate an image to go along with the message.",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("Checking runtime configuration...");
        const modelProvider = runtime.modelProvider;
        elizaLogger.log("Current model provider:", modelProvider);

        const togetherApiKey = runtime.getSetting("TOGETHER_API_KEY");
        elizaLogger.log("Together API key present:", !!togetherApiKey);

        if (!togetherApiKey) {
            elizaLogger.error("Together API key not found - required for image generation");
        }

        return !!togetherApiKey;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback: HandlerCallback
    ) => {
        try {
            // Extract prompt from message with proper null checking
            if (!message?.content?.text) {
                return {
                    success: false,
                    content: {
                        text: "No prompt provided for image generation"
                    }
                };
            }

            // Clean up the prompt by removing mentions and extra whitespace
            const cleanPrompt = message.content.text
                .replace(/<@[0-9]+>/g, '')  // Remove Discord mentions
                .trim();

            if (!cleanPrompt) {
                return {
                    success: false,
                    content: {
                        text: "Please provide a description of what you'd like me to generate"
                    }
                };
            }

            // Generate the image
            const imageResult = await generateImage(
                {
                    prompt: cleanPrompt,
                    width: 1024,
                    height: 1024,
                    count: 1,
                },
                runtime
            );

            if (!imageResult.success || !imageResult.data || !imageResult.data.length) {
                throw new Error(imageResult.error || "Failed to generate image");
            }

            // Process the generated image
            const base64Image = imageResult.data[0];
            if (!base64Image) {
                throw new Error("No image data received");
            }

            // Convert base64 to buffer
            const imageBuffer = Buffer.from(base64Image, 'base64');

            return {
                success: true,
                content: {
                    text: "Here's your generated image:",
                    attachments: [{
                        type: "image",
                        data: imageBuffer,
                        filename: "generated_image.png"
                    }]
                }
            };
        } catch (error) {
            console.error("Error in image generation handler:", error);
            return {
                success: false,
                content: {
                    text: `Sorry, I couldn't generate that image. Error: ${error.message}`
                }
            };
        }
    },
    examples: [
        // TODO: We want to generate images in more abstract ways, not just when asked to generate an image

        [
            {
                user: "{{user1}}",
                content: { text: "Generate an image of a cat" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's an image of a cat",
                    action: "GENERATE_IMAGE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Generate an image of a dog" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's an image of a dog",
                    action: "GENERATE_IMAGE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Create an image of a cat with a hat" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's an image of a cat with a hat",
                    action: "GENERATE_IMAGE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Make an image of a dog with a hat" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's an image of a dog with a hat",
                    action: "GENERATE_IMAGE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Paint an image of a cat with a hat" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's an image of a cat with a hat",
                    action: "GENERATE_IMAGE",
                },
            },
        ],
    ],
} as Action;

export const imageGenerationPlugin: Plugin = {
    name: "imageGeneration",
    description: "Generate images",
    actions: [imageGeneration],
    evaluators: [],
    providers: [],
};
