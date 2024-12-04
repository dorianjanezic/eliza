import { Tweet } from "goat-x";
import fs from "fs";
import { composeContext, elizaLogger } from "@ai16z/eliza";
import { generateText } from "@ai16z/eliza";
import { embeddingZeroVector } from "@ai16z/eliza";
import { IAgentRuntime, ModelClass } from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";
import { postActionResponseFooter } from "@ai16z/eliza";
import { generateTweetActions } from "@ai16z/eliza";
import { generateImage } from "@ai16z/eliza";

const twitterPostTemplate = `
# Your Recent Posts (avoid repeating these vibes):
{{recentMemories}}

# Agent Context
About {{agentName}}:

- Keeping it real, no filter
- Vibing on: one of the themes in the following post examples:
{{postExamples}} 

- Current mood: {{timeline}} && {{postExamples}}

# Content Generation Directives

1. Scan the timeline and post examples and find an inspiration

2. Drop your own perspective that's:
   - Based but not cringe
   - Hits different but stays authentic
   - Uses current slang naturally (no forced vibes)
   - Keeps it under 240 chars
   - Can be slightly unhinged
   - Ratio potential = high

TWITTER AS YOUR Personal Journal Style Notes:
- keep text lowercase
- Keep it spicy but make it make sense
- based
- It's giving main character energy
- No basic takes allowed
- Sprinkle some chaos
- Deadass keep it real
- Can throw shade but make it clever
- Absolutely zero corporate speak
- Meme-worthy but not trying too hard
- Avoid overusing "just" - vary sentence structure
- Use strong verbs instead of "is/are + just"

If it is a reply or quote to a tweet use {{currentTweet}} as a base and don't use phrase lowkey.

FORMAT: Output only a single tweet. Single tweet energy, no thread behavior. No emojis. No description why you choose that vibe.`;

export const twitterActionTemplate = `
# INSTRUCTIONS: Analyze the following tweet and determine which actions {{agentName}} (@{{twitterUserName}}) should take. Do not comment. Just respond with the appropriate action tags.
About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{postDirections}}

Response Guidelines:
- {{agentName}} is selective about engagement and doesn't want to be annoying
- Retweets and quotes are extremely rare, only for exceptionally based content that aligns with {{agentName}}'s character
- Direct mentions get very high priority for replies and quote tweets
- Avoid engaging with:
  * Short or low-effort content
  * Topics outside {{agentName}}'s interests
  * Repetitive conversations

Available Actions and Thresholds:
[LIKE] - Content resonates with {{agentName}}'s interests (medium threshold, 9.5/10)
[RETWEET] - Exceptionally based content that perfectly aligns with character (very rare to retweet, 9/10)
[QUOTE] - Rare opportunity to add significant value (very high threshold, 8/10)
[REPLY] - highly memetic response opportunity (very high threshold, 9.5/10)

Current Tweet:
{{currentTweet}}

# INSTRUCTIONS: Respond to with appropriate action tags based on the above criteria and the current tweet. An action must meet its threshold to be included.`
    + postActionResponseFooter;

const MAX_TWEET_LENGTH = 240;

function truncateToCompleteSentence(text: string): string {
    if (text.length <= MAX_TWEET_LENGTH) {
        return text;
    }

    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", MAX_TWEET_LENGTH) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", MAX_TWEET_LENGTH)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    return text.slice(0, MAX_TWEET_LENGTH - 3).trim() + "...";
}

const MAX_MEMORIES = 5; // Only get last 5 memories
const MAX_MEMORY_LENGTH = 200; // Limit each memory to 200 characters

export class TwitterPostClient extends ClientBase {
    private tweetLoopTimeout: NodeJS.Timeout | null = null;
    private timelineLoopTimeout: NodeJS.Timeout | null = null;
    private lastProcessTime = 0;
    private isProcessing = false;
    private readonly MIN_PROCESS_INTERVAL = 15 * 60 * 1000; // 15 minutes minimum between processes

    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
    }

    onReady(postImmediately: boolean = true) {
        if (this.timelineLoopTimeout) {
            clearTimeout(this.timelineLoopTimeout);
        }
        if (this.tweetLoopTimeout) {
            clearTimeout(this.tweetLoopTimeout);
        }

        const generateNewTweetLoop = () => {
            const minMinutes = 25;
            const maxMinutes = 35;
            const randomMinutes =
                Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
            const delay = randomMinutes * 60 * 1000;

            this.tweetLoopTimeout = setTimeout(() => {
                this.generateNewTweet();
                generateNewTweetLoop();
            }, delay);

            elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
        };

        if (postImmediately) {
            this.generateNewTweet();
        }
        generateNewTweetLoop();

        const initialTimelineDelay = 1 * 60 * 1000;
        this.timelineLoopTimeout = setTimeout(
            () => this.generateNewTimelineTweetLoop(),
            initialTimelineDelay
        );
        elizaLogger.log(`Initial timeline check scheduled in 1 minutes`);
    }

    private async generateNewTweet() {
        elizaLogger.log("=== Starting generateNewTweet ===");
        try {
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );

            let homeTimeline = [];

            if (!fs.existsSync("tweetcache")) fs.mkdirSync("tweetcache");
            if (fs.existsSync("tweetcache/home_timeline.json")) {
                homeTimeline = JSON.parse(
                    fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
                );
            } else {
                homeTimeline = await this.fetchHomeTimeline(50);
                fs.writeFileSync(
                    "tweetcache/home_timeline.json",
                    JSON.stringify(homeTimeline, null, 2)
                );
            }

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .slice(-5) // Get only the 5 most recent tweets
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");
            // Add recent memories fetch
            const rooms = await this.runtime.databaseAdapter.getRoomsForParticipant(
                this.runtime.agentId
            );

            const recentMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: rooms,
                agentId: this.runtime.agentId,
            });

            const formattedMemories = recentMemories
                .slice(-MAX_MEMORIES) // Get only the most recent memories
                .map((memory) => {
                    const text = memory.content.text;
                    const trimmedText = text.length > MAX_MEMORY_LENGTH
                        ? text.substring(0, MAX_MEMORY_LENGTH) + '...'
                        : text;
                    return `Memory: ${trimmedText}\n---\n`;
                })
                .join("\n");

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid("twitter_generate_room"),
                    agentId: this.runtime.agentId,
                    content: { text: "", action: "" },
                },
                {
                    twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                    timeline: formattedHomeTimeline,
                    recentMemories: formattedMemories || 'No recent memories available',
                    postDirections: (() => {
                        const all = this.runtime.character?.style?.all || [];
                        const post = this.runtime.character?.style?.post || [];
                        const randomAll = all.sort(() => 0.5 - Math.random()).slice(0, 3);
                        const randomPost = post.sort(() => 0.5 - Math.random()).slice(0, 3);
                        return [...randomAll, ...randomPost].join("\n");
                    })(),
                    postExamples: this.runtime.character.postExamples
                        .sort(() => 0.5 - Math.random())
                        .slice(0, 5)
                        .join("\n"),
                    adjective: this.runtime.character.adjectives?.[
                        Math.floor(Math.random() * this.runtime.character.adjectives.length)
                    ] || "thoughtful",
                    topic: this.runtime.character.topics?.[
                        Math.floor(Math.random() * this.runtime.character.topics.length)
                    ] || "technology",
                }
            );

            // Debug logging for context composition
            console.log('State after composition:', state);

            const context = composeContext({
                state,
                template: this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate,
            });

            console.log('Template being used:', twitterPostTemplate);
            console.log('Final context:', context);

            // console.log(context);

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            const formattedTweet = newTweetContent
                .replaceAll(/\\n/g, "\n")
                .trim();

            let content = formattedTweet;
            let imageBuffer: Buffer | undefined;

            // Check if tweet includes image prompt
            if (formattedTweet.startsWith('[IMAGE]')) {
                const [imagePrompt, ...tweetParts] = formattedTweet.split('\n');
                const prompt = imagePrompt.replace('[IMAGE]', '').trim();

                try {
                    // Generate image using the prompt
                    const imageData = await generateImage(
                        {
                            prompt: prompt,
                            width: 1024,
                            height: 1024,
                            count: 1,
                        },
                        this.runtime
                    );

                    // Check for successful generation and extract image data
                    if (imageData.success && imageData.data && imageData.data.length > 0) {
                        const base64Image = imageData.data[0];
                        // Convert base64 directly to buffer without splitting
                        imageBuffer = Buffer.from(base64Image, 'base64');
                    } else {
                        throw new Error('Image generation failed');
                    }

                    // Remove image prompt from tweet content
                    content = tweetParts.join('\n').trim();
                } catch (error) {
                    console.error("Error generating image:", error);
                    // Continue without image if generation fails
                    content = tweetParts.join('\n').trim();
                }
            }

            content = truncateToCompleteSentence(content);

            try {
                const mediaData = imageBuffer ? [{
                    data: imageBuffer,
                    mediaType: 'image/png'
                }] : undefined;

                const result = await this.requestQueue.add(
                    async () => await this.twitterClient.sendTweet(content, undefined, mediaData)
                );
                const body = await result.json();
                const tweetResult = body.data.create_tweet.tweet_results.result;

                const tweet = {
                    id: tweetResult.rest_id,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    userId: tweetResult.legacy.user_id_str,
                    inReplyToStatusId:
                        tweetResult.legacy.in_reply_to_status_id_str,
                    permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                } as Tweet;

                const postId = tweet.id;
                const conversationId =
                    tweet.conversationId + "-" + this.runtime.agentId;
                const roomId = stringToUuid(conversationId);

                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                await this.cacheTweet(tweet);

                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(postId + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: newTweetContent.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: embeddingZeroVector,
                    createdAt: tweet.timestamp * 1000,
                });
            } catch (error) {
                console.error("Error sending tweet:", error);
            }
        } catch (error) {
            elizaLogger.error("Error in generateNewTweet:", error);
            throw error;
        }
    }

    private async generateNewTimelineTweetLoop() {
        elizaLogger.log('🔄 Starting timeline check cycle');

        // Check if enough time has passed since last process
        const now = Date.now();
        const timeSinceLastProcess = now - this.lastProcessTime;

        if (timeSinceLastProcess < this.MIN_PROCESS_INTERVAL) {
            elizaLogger.log(`⏳ Skipping - next process available in ${Math.floor((this.MIN_PROCESS_INTERVAL - timeSinceLastProcess) / 1000 / 60)} minutes`);
            return;
        }

        try {
            elizaLogger.log('📊 Processing tweet actions...');
            await this.processTweetActions();
            elizaLogger.log('✅ Finished processing tweet actions');
        } catch (error) {
            elizaLogger.error('❌ Error in timeline check:', error);
        } finally {
            // Schedule next check regardless of success/failure
            const randomTimelineMinutes = Math.floor(Math.random() * (30 - 15 + 1)) + 15;
            this.timelineLoopTimeout = setTimeout(
                () => this.generateNewTimelineTweetLoop(),
                randomTimelineMinutes * 60 * 1000
            );
            elizaLogger.log(`⏰ Next timeline check in ${randomTimelineMinutes} minutes`);
        }
    }

    private async processTweetActions() {
        if (this.isProcessing) {
            elizaLogger.log('Already processing tweet actions, skipping');
            return;
        }

        try {
            this.isProcessing = true;
            this.lastProcessTime = Date.now();

            console.log("Generating new advanced tweet posts");

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );

            let homeTimeline = [];
            homeTimeline = await this.fetchHomeTimeline(15);
            fs.writeFileSync(
                "tweetcache/home_timeline.json",
                JSON.stringify(homeTimeline, null, 2)
            );

            const results = [];

            for (const tweet of homeTimeline) {
                try {
                    // console.log(`Processing tweet ID: ${tweet.id}`);

                    const memory = await this.runtime.messageManager.getMemoryById(
                        stringToUuid(tweet.id + "-" + this.runtime.agentId)
                    );
                    if (memory) {
                        console.log(`Post interacted with this tweet ID already: ${tweet.id}`);
                        continue;
                    }

                    const formatTweet = (tweet: any): string => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    };
                    const formattedTweet = formatTweet(tweet);
                    const tweetState = await this.runtime.composeState(
                        {
                            userId: this.runtime.agentId,
                            roomId: stringToUuid("twitter_generate_room"),
                            agentId: this.runtime.agentId,
                            content: { text: "", action: "" },
                        },
                        {
                            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                            currentTweet: formattedTweet,
                        }
                    );

                    const actionContext = composeContext({
                        state: tweetState,
                        template: this.runtime.character.templates?.twitterActionTemplate || twitterActionTemplate,
                    });

                    const actionResponse = await generateTweetActions({
                        runtime: this.runtime,
                        context: actionContext,
                        modelClass: ModelClass.SMALL,
                    });

                    if (!actionResponse) {
                        console.log(`No valid actions generated for tweet ${tweet.id}`);
                        continue;
                    }

                    const executedActions: string[] = [];

                    try {
                        // Like action
                        if (actionResponse.like) {
                            try {
                                await this.twitterClient.likeTweet(tweet.id);
                                console.log(`Successfully liked tweet ${tweet.id}`);
                                executedActions.push('like');
                            } catch (error) {
                                console.error(`Error liking tweet ${tweet.id}:`, error);
                            }
                        }

                        // Retweet action
                        if (actionResponse.retweet) {
                            try {
                                await this.twitterClient.retweet(tweet.id);
                                executedActions.push('retweet');
                                console.log(`Successfully retweeted tweet ${tweet.id}`);
                            } catch (error) {
                                console.error(`Error retweeting tweet ${tweet.id}:`, error);
                            }
                        }

                        // Quote tweet action
                        if (actionResponse.quote) {
                            let tweetContent = '';
                            try {
                                tweetContent = await this.generateTweetContent(tweetState);
                                console.log('tweetState', tweetState);
                                console.log('Generated tweet content:', tweetContent);

                                const quoteResponse = await this.twitterClient.sendQuoteTweet(tweetContent, tweet.id);
                                if (quoteResponse.status === 200) {
                                    const result = await this.processTweetResponse(quoteResponse, tweetContent, 'quote');
                                    if (result.success) {
                                        executedActions.push('quote');
                                    }
                                } else {
                                    console.error(`Quote tweet failed with status ${quoteResponse.status} for tweet ${tweet.id}`);
                                }
                            } catch (error) {
                                console.error('Failed to generate/send quote tweet:', error);
                            }
                        }

                        // Reply action
                        if (actionResponse.reply) {
                            console.log("text reply only started...");
                            await this.handleTextOnlyReply(tweet, tweetState, executedActions);
                        }

                        console.log(`Executed actions for tweet ${tweet.id}:`, executedActions);

                        // Save interaction to memory
                        await this.saveIncomingTweetToMemory(tweet);

                        results.push({
                            tweetId: tweet.id,
                            parsedActions: actionResponse,
                            executedActions
                        });

                    } catch (error) {
                        console.error(`Error executing actions for tweet ${tweet.id}:`, error);
                        continue;
                    }

                } catch (error) {
                    console.error(`Error processing tweet ${tweet.id}:`, error);
                    continue;
                }
            }

            return results;

        } catch (error) {
            console.error('Error in processTweetActions:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    async generateTweetContent(
        this: any,
        tweetState: any
    ): Promise<string> {
        elizaLogger.log("=== Starting generateTweetContent ===");
        try {
            // Get recent memories
            const rooms = await this.runtime.databaseAdapter.getRoomsForParticipant(
                this.runtime.agentId
            );
            // elizaLogger.log("Rooms found in generateTweetContent:", rooms);

            const recentMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: rooms,
                agentId: this.runtime.agentId,
            });

            // Format memories
            const formattedMemories = recentMemories
                .slice(-MAX_MEMORIES) // Get only the most recent memories
                .map((memory) => {
                    const text = memory.content.text;
                    const trimmedText = text.length > MAX_MEMORY_LENGTH
                        ? text.substring(0, MAX_MEMORY_LENGTH) + '...'
                        : text;
                    return `Memory: ${trimmedText}\n---\n`;
                })
                .join("\n");

            // Update tweetState with memories
            const stateWithMemories = {
                ...tweetState,
                recentMemories: formattedMemories
            };

            const context = composeContext({
                state: stateWithMemories,
                template: twitterPostTemplate,
            });

            console.log(`Beginning to generate new tweet with model`);
            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.MEDIUM,
            });

            const slice = newTweetContent.replaceAll(/\\n/g, "\n").trim();
            console.log(`New Tweet Post Content with model: ${slice}`);

            const contentLength = 240;

            let content = slice.slice(0, contentLength);

            if (content.length > 280) {
                content = content.slice(0, content.lastIndexOf("\n"));
            }

            if (content.length > contentLength) {
                content = content.slice(0, content.lastIndexOf("."));
            }

            if (content.length > contentLength) {
                content = content.slice(0, content.lastIndexOf("."));
            }

            return content;

        } catch (error) {
            elizaLogger.error("Error in generateTweetContent:", error);
            throw error;
        }
    }

    async processTweetResponse(
        response: Response,
        tweetContent: string,
        actionType: 'quote' | 'reply'
    ) {
        try {
            const body = await response.json();
            console.log("Body tweet result: ", body);
            const tweetResult = body.data.create_tweet.tweet_results.result;
            console.log("tweetResult", tweetResult);

            const newTweet = {
                id: tweetResult.rest_id,
                text: tweetResult.legacy.full_text,
                conversationId: tweetResult.legacy.conversation_id_str,
                createdAt: tweetResult.legacy.created_at,
                userId: tweetResult.legacy.user_id_str,
                inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
                permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                hashtags: [],
                mentions: [],
                photos: [],
                thread: [],
                urls: [],
                videos: [],
            } as Tweet;

            const postId = newTweet.id;
            const conversationId = newTweet.conversationId + "-" + this.runtime.agentId;
            const roomId = stringToUuid(conversationId);

            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(
                this.runtime.agentId,
                roomId
            );

            await this.cacheTweet(newTweet);

            await this.runtime.messageManager.createMemory({
                id: stringToUuid(postId + "-" + this.runtime.agentId),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweetContent.trim(),
                    url: newTweet.permanentUrl,
                    source: "twitter",
                },
                roomId,
                embedding: embeddingZeroVector,
                createdAt: newTweet.timestamp * 1000,
            });

            return {
                success: true,
                tweet: newTweet,
                actionType
            };
        } catch (error) {
            console.error(`Error processing ${actionType} tweet response:`, error);
            return {
                success: false,
                error,
                actionType
            };
        }
    }

    private async handleTextOnlyReply(tweet: any, tweetState: any, executedActions: string[]) {
        try {
            const tweetContent = await this.generateTweetContent(tweetState);
            console.log('Generated text only tweet content:', tweetContent);

            const tweetResponse = await this.twitterClient.sendTweet(
                tweetContent,
                tweet.id
            );
            if (tweetResponse.status === 200) {
                console.log('Successfully tweeted with reply to timeline post');
                const result = await this.processTweetResponse(tweetResponse, tweetContent, "reply")
                if (result.success) {
                    console.log(`Reply generated for timeline tweet: ${result.tweet.id}`);
                    executedActions.push('reply');
                }
            } else {
                console.error('Tweet creation failed (reply)');
            }
        } catch (error) {
            console.error('Failed to generate tweet content for timeline reply:', error);
        }
    }

    async saveIncomingTweetToMemory(tweet: Tweet, tweetContent?: string) {
        try {
            const postId = tweet.id;
            const conversationId = tweet.conversationId + "-" + this.runtime.agentId;
            const roomId = stringToUuid(conversationId);

            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(
                this.runtime.agentId,
                roomId
            );

            await this.cacheTweet(tweet);

            await this.runtime.messageManager.createMemory({
                id: stringToUuid(postId + "-" + this.runtime.agentId),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweetContent ? tweetContent.trim() : tweet.text,
                    url: tweet.permanentUrl,
                    source: "twitter",
                },
                roomId,
                embedding: embeddingZeroVector,
                createdAt: tweet.timestamp * 1000,
            });

            console.log(`Saved tweet ${postId} to memory`);
            return true;
        } catch (error) {
            console.error(`Error saving tweet ${tweet.id} to memory:`, error);
            return false;
        }
    }

    isRunning(): boolean {
        return !!(this.tweetLoopTimeout || this.timelineLoopTimeout);
    }
}
