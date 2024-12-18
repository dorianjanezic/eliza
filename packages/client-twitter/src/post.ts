import { Tweet } from "goat-x";
import {
    composeContext,
    generateText,
    getEmbeddingZeroVector,
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    parseBooleanFromText,
    generateMessageResponse,
    Content,
    embed
} from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";
import { postActionResponseFooter } from "@ai16z/eliza";
import { generateTweetActions } from "@ai16z/eliza";
import { IImageDescriptionService, ServiceType } from "@ai16z/eliza";
import { buildConversationThread } from "./utils.ts";
import { twitterMessageHandlerTemplate } from "./interactions.ts";

const twitterPostTemplate = `
# Your Recent Posts/Memories (avoid repeating these vibes):
{{agentsTweets}}

# Content Generation Directives

1. Scan the feed timeline to feel updated on the current mood and adjust your mood accordingly:

# Feed Timeline:
{{feedTimeline}}

# Agent Context
About {{agentName}}:
{{providers}}


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

# IMPORTANT:
    Drop your own perspective in a form of a note that's:
   - Based but not cringe
   - Hits different but stays authentic
   - Uses current slang naturally (no forced vibes)
   - Keeps it under 240 chars
   - Keep it spicy but make it make sense
   - Can be slightly unhinged
   - Ratio potential = high
   - express yourself from first person from the perspective of {{agentName}}

CRITICAL: NEVER TWEET THE SAME THING TWICE. HIGH VARIANCE in your posts.
Always tweet bangers.
Always start with a different word from your previous posts.


# IMPORTANT
- Vibing on one of the themes in the following post references
- Use reference for sentence structure and theme of the post you are about to generate
- analyze first words in the posts and use them accordingly in your next tweet
{{characterPostExamples}}

FORMAT: Output only a single tweet. Single tweet energy, no thread behavior. No emojis. No description why you choose that vibe. Write something different from your recent posts.`;

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
[REPLY] - highly memetic response opportunity (very high threshold, 9/10)

Current Tweet:
{{currentTweet}}

# INSTRUCTIONS: Respond to with appropriate action tags based on the above criteria and the current tweet. An action must meet its threshold to be included.`
    + postActionResponseFooter;

const MAX_TWEET_LENGTH = 240;

/**
 * Truncate text to fit within the Twitter character limit, ensuring it ends at a complete sentence.
 */
function truncateToCompleteSentence(text: string): string {
    if (text.length <= MAX_TWEET_LENGTH) {
        return text;
    }

    // Attempt to truncate at the last period within the limit
    const truncatedAtPeriod = text.slice(
        0,
        text.lastIndexOf(".", MAX_TWEET_LENGTH) + 1
    );
    if (truncatedAtPeriod.trim().length > 0) {
        return truncatedAtPeriod.trim();
    }

    // If no period is found, truncate to the nearest whitespace
    const truncatedAtSpace = text.slice(
        0,
        text.lastIndexOf(" ", MAX_TWEET_LENGTH)
    );
    if (truncatedAtSpace.trim().length > 0) {
        return truncatedAtSpace.trim() + "...";
    }

    // Fallback: Hard truncate and add ellipsis
    return text.slice(0, MAX_TWEET_LENGTH - 3).trim() + "...";
}

export class TwitterPostClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    private isProcessing: boolean = false;
    private lastProcessTime: number = 0;
    private stopProcessingActions: boolean = false;

    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            // Enhanced validation
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                elizaLogger.warn('Empty or invalid text provided for embedding generation:', {
                    receivedText: text,
                    type: typeof text
                });
                return getEmbeddingZeroVector();
            }

            // Generate embedding
            const embedding = await embed(this.runtime, text);

            // Log the embedding details
            elizaLogger.debug('Generated embedding:', {
                text: text.slice(0, 100) + (text.length > 100 ? '...' : ''), // First 100 chars of input
                embeddingLength: embedding?.length,
                embeddingSample: embedding?.slice(0, 5), // First 5 values
                isArray: Array.isArray(embedding),
                allNumbers: embedding?.every(n => typeof n === 'number')
            });

            // Validate embedding result
            if (!Array.isArray(embedding) || embedding.length === 0) {
                elizaLogger.warn('Invalid embedding generated:', {
                    embedding,
                    textLength: text.length
                });
                return getEmbeddingZeroVector();
            }

            return embedding;
        } catch (error) {
            elizaLogger.error('Error generating embedding:', error);
            return getEmbeddingZeroVector();
        }
    }

    async start(postImmediately: boolean = false) {
        if (!this.client.profile) {
            await this.client.init();
        }

        const generateNewTweetLoop = async () => {
            const lastPost = await this.runtime.cacheManager.get<{
                timestamp: number;
            }>(
                "twitter/" +
                    this.runtime.getSetting("TWITTER_USERNAME") +
                    "/lastPost"
            );

            const lastPostTimestamp = lastPost?.timestamp ?? 0;
            const minMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MIN")) || 1;
            const maxMinutes =
                parseInt(this.runtime.getSetting("POST_INTERVAL_MAX")) || 2;
            const randomMinutes =
                Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) +
                minMinutes;
            const delay = randomMinutes * 60 * 1000;

            if (Date.now() > lastPostTimestamp + delay) {
                await this.generateNewTweet();
            }

            setTimeout(() => {
                generateNewTweetLoop(); // Set up next iteration
            }, delay);

            elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
        };

        const processActionsLoop = async () => {
            const actionInterval = parseInt(
                this.runtime.getSetting("ACTION_INTERVAL")
            ) || 300000; // Default to 5 minutes

            while (!this.stopProcessingActions) {
                try {
                    const results = await this.processTweetActions();
                    if (results) {
                        elizaLogger.log(`Processed ${results.length} tweets`);
                        elizaLogger.log(`Next action processing scheduled in ${actionInterval / 1000} seconds`);
                        // Wait for the full interval before next processing
                        await new Promise(resolve => setTimeout(resolve, actionInterval));
                    }
                } catch (error) {
                    elizaLogger.error("Error in action processing loop:", error);
                    // Add exponential backoff on error
                    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s on error
                }
            }
        };

        if (
            this.runtime.getSetting("POST_IMMEDIATELY") != null &&
            this.runtime.getSetting("POST_IMMEDIATELY") != ""
        ) {
            postImmediately = parseBooleanFromText(
                this.runtime.getSetting("POST_IMMEDIATELY")
            );
        }

        if (postImmediately) {
            await this.generateNewTweet();
        }

        // Start both loops
        generateNewTweetLoop();
        processActionsLoop().catch(error => {
            elizaLogger.error("Fatal error in process actions loop:", error);
        });
    }

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
    }

    private async generateNewTweet() {
        elizaLogger.log("Generating new tweet");

        try {
            const roomId = stringToUuid(
                "twitter_generate_room-" + this.client.profile.username
            );
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.client.profile.username,
                this.runtime.character.name,
                "twitter"
            );

            const topics = this.runtime.character.topics.join(", ");

            // Fetch timeline
            const homeTimeline = await this.client.fetchHomeTimeline(10);
            const feedTimeline = await this.client.fetchFeedTimeline(10);

            // Split into agent's posts and other users' posts
            const agentsTweets = homeTimeline
                .filter(tweet => tweet.userId === this.client.profile.id)
                .map(tweet => `@${tweet.username}: ${tweet.text}`)
                .join("\n\n");


            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: roomId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: topics || '',
                        action: "TWEET",
                    },
                },
                {
                    twitterUserName: this.client.profile.username,
                    agentsTweets: agentsTweets || '',
                    feedTimeline: feedTimeline || [],
                }
            );

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterPostTemplate ||
                    twitterPostTemplate,
            });

            elizaLogger.debug("generate post prompt:\n" + context);
            console.log("generate post prompt:\n" + context);

            const newTweetContent = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            // First attempt to clean content
            let cleanedContent = '';

            // Try parsing as JSON first
            try {
                const parsedResponse = JSON.parse(newTweetContent);
                if (parsedResponse.text) {
                    cleanedContent = parsedResponse.text;
                } else if (typeof parsedResponse === 'string') {
                    cleanedContent = parsedResponse;
                }
            } catch (error) {
                // If not JSON, clean the raw content
                cleanedContent = newTweetContent
                    .replace(/^\s*{?\s*"text":\s*"|"\s*}?\s*$/g, '') // Remove JSON-like wrapper
                    .replace(/^['"](.*)['"]$/g, '$1')  // Remove quotes
                    .replace(/\\"/g, '"')  // Unescape quotes
                    .trim();
            }

            if (!cleanedContent) {
                elizaLogger.error('Failed to extract valid content from response:', {
                    rawResponse: newTweetContent,
                    attempted: 'JSON parsing'
                });
                return;
            }

            // Use the helper function to truncate to complete sentence
            const content = truncateToCompleteSentence(cleanedContent);

            const removeQuotes = (str: string) =>
                str.replace(/^['"](.*)['"]$/, "$1");

            // Final cleaning
            cleanedContent = removeQuotes(content);

            if (this.runtime.getSetting("TWITTER_DRY_RUN") === "true") {
                elizaLogger.info(
                    `Dry run: would have posted tweet: ${cleanedContent}`
                );
                return;
            }

            try {
                elizaLogger.log(`Posting new tweet:\n ${cleanedContent}`);

                const result = await this.client.requestQueue.add(
                    async () =>
                        await this.client.twitterClient.sendTweet(cleanedContent)
                );
                const body = await result.json();
                if (!body?.data?.create_tweet?.tweet_results?.result) {
                    console.error("Error sending tweet; Bad response:", body);
                    return;
                }
                const tweetResult = body.data.create_tweet.tweet_results.result;

                const tweet = {
                    id: tweetResult.rest_id,
                    name: this.client.profile.screenName,
                    username: this.client.profile.username,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    timestamp: new Date(
                        tweetResult.legacy.created_at
                    ).getTime(),
                    userId: this.client.profile.id,
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

                await this.runtime.cacheManager.set(
                    `twitter/${this.client.profile.username}/lastPost`,
                    {
                        id: tweet.id,
                        timestamp: Date.now(),
                    }
                );

                await this.client.cacheTweet(tweet);

                elizaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(
                    this.runtime.agentId,
                    roomId
                );

                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: newTweetContent.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: await this.generateEmbedding(tweet.text),
                    createdAt: tweet.timestamp,
                });
            } catch (error) {
                elizaLogger.error("Error sending tweet:", error);
            }
        } catch (error) {
            elizaLogger.error("Error generating new tweet:", error);
        }
    }

    private async generateTweetContent(tweetState: any, options?: {
        template?: string;
        context?: string;
    }): Promise<string> {
        const context = composeContext({
            state: tweetState,
            template: options?.template || this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate,
        });

        const response = await generateText({
            runtime: this.runtime,
            context: options?.context || context,
            modelClass: ModelClass.SMALL
        });
        console.log("generate tweet content response:\n" + response);

        // First clean up any markdown and newlines
        let cleanedResponse = response
            .replace(/```json\s*/g, '')  // Remove ```json
            .replace(/```\s*/g, '')      // Remove any remaining ```
            .replaceAll(/\\n/g, "\n")
            .trim();

        // Try to parse as JSON first
        try {
            const jsonResponse = JSON.parse(cleanedResponse);
            if (jsonResponse.text) {
                return this.trimTweetLength(jsonResponse.text);
            }
            if (typeof jsonResponse === 'object') {
                const possibleContent = jsonResponse.content || jsonResponse.message || jsonResponse.response;
                if (possibleContent) {
                    return this.trimTweetLength(possibleContent);
                }
            }
        } catch (error) {
            // If JSON parsing fails, treat as plain text
            elizaLogger.debug('Response is not JSON, treating as plain text');
        }

        // If not JSON or no valid content found, clean the raw text
        return this.trimTweetLength(cleanedResponse);
    }

    // Helper method to ensure tweet length compliance
    private trimTweetLength(text: string, maxLength: number = 280): string {
        if (text.length <= maxLength) return text;

        // Try to cut at last sentence
        const lastSentence = text.slice(0, maxLength).lastIndexOf('.');
        if (lastSentence > 0) {
            return text.slice(0, lastSentence + 1).trim();
        }

        // Fallback to word boundary
        return text.slice(0, text.lastIndexOf(' ', maxLength - 3)).trim() + '...';
    }

    private async processTweetActions() {
        if (this.isProcessing) {
            elizaLogger.log('Already processing tweet actions, skipping');
            return null;
        }

        try {
            this.isProcessing = true;
            this.lastProcessTime = Date.now();

            elizaLogger.log("Processing tweet actions");

            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );

            const homeTimeline = await this.client.fetchTimelineForActions(15); // Fixed to 10 tweets
            const results = [];

            for (const tweet of homeTimeline) {
                try {
                    // Skip if we've already processed this tweet
                    const memory = await this.runtime.messageManager.getMemoryById(
                        stringToUuid(tweet.id + "-" + this.runtime.agentId)
                    );
                    if (memory) {
                        elizaLogger.log(`Already processed tweet ID: ${tweet.id}`);
                        continue;
                    }

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const tweetState = await this.runtime.composeState(
                        {
                            userId: this.runtime.agentId,
                            roomId,
                            agentId: this.runtime.agentId,
                            content: { text: "", action: "" },
                        },
                        {
                            twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                            currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
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
                        elizaLogger.log(`No valid actions generated for tweet ${tweet.id}`);
                        continue;
                    }

                    const executedActions: string[] = [];

                    // Execute actions
                    if (actionResponse.like) {
                        try {
                            await this.client.twitterClient.likeTweet(tweet.id);
                            executedActions.push('like');
                            elizaLogger.log(`Liked tweet ${tweet.id}`);
                        } catch (error) {
                            elizaLogger.error(`Error liking tweet ${tweet.id}:`, error);
                        }
                    }

                    if (actionResponse.retweet) {
                        try {
                            await this.client.twitterClient.retweet(tweet.id);
                            executedActions.push('retweet');
                            elizaLogger.log(`Retweeted tweet ${tweet.id}`);
                        } catch (error) {
                            elizaLogger.error(`Error retweeting tweet ${tweet.id}:`, error);
                        }
                    }

                    if (actionResponse.quote) {
                        try {
                            // Build conversation thread for context
                            const thread = await buildConversationThread(tweet, this.client);
                            const formattedConversation = thread
                                .map((t) => `@${t.username} (${new Date(t.timestamp * 1000).toLocaleString()}): ${t.text}`)
                                .join("\n\n");

                            // Generate image descriptions if present
                            const imageDescriptions = [];
                            if (tweet.photos?.length > 0) {
                                elizaLogger.log('Processing images in tweet for context');
                                for (const photo of tweet.photos) {
                                    const description = await this.runtime
                                        .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                                        .describeImage(photo.url);
                                    imageDescriptions.push(description);
                                }
                            }

                            // Handle quoted tweet if present
                            let quotedContent = '';
                            if (tweet.quotedStatusId) {
                                try {
                                    const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId);
                                    if (quotedTweet) {
                                        quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                                    }
                                } catch (error) {
                                    elizaLogger.error('Error fetching quoted tweet:', error);
                                }
                            }

                            // Compose rich state with all context
                            const enrichedState = await this.runtime.composeState(
                                {
                                    userId: this.runtime.agentId,
                                    roomId: stringToUuid(tweet.conversationId + "-" + this.runtime.agentId),
                                    agentId: this.runtime.agentId,
                                    content: { text: tweet.text, action: "QUOTE" }
                                },
                                {
                                    twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                                    currentPost: `From @${tweet.username}: ${tweet.text}`,
                                    formattedConversation,
                                    imageContext: imageDescriptions.length > 0
                                        ? `\nImages in Tweet:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join('\n')}`
                                        : '',
                                    quotedContent,
                                }
                            );

                            const quoteContent = await this.generateTweetContent(enrichedState, {
                                template: this.runtime.character.templates?.twitterMessageHandlerTemplate || twitterMessageHandlerTemplate
                            });

                            if (!quoteContent) {
                                elizaLogger.error('Failed to generate valid quote tweet content');
                                return;
                            }

                            elizaLogger.log('Generated quote tweet content:', quoteContent);

                            // Send the tweet through request queue
                            const result = await this.client.requestQueue.add(
                                async () => await this.client.twitterClient.sendQuoteTweet(
                                    quoteContent,
                                    tweet.id
                                )
                            );

                            const body = await result.json();

                            if (body?.data?.create_tweet?.tweet_results?.result) {
                                elizaLogger.log('Successfully posted quote tweet');
                                executedActions.push('quote');

                                // Cache generation context for debugging
                                await this.runtime.cacheManager.set(
                                    `twitter/quote_generation_${tweet.id}.txt`,
                                    `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
                                );
                            } else {
                                elizaLogger.error('Quote tweet creation failed:', body);
                            }
                        } catch (error) {
                            elizaLogger.error('Error in quote tweet generation:', error);
                        }
                    }

                    if (actionResponse.reply) {
                        try {
                            await this.handleTextOnlyReply(tweet, tweetState, executedActions);
                        } catch (error) {
                            elizaLogger.error(`Error replying to tweet ${tweet.id}:`, error);
                        }
                    }

                    // Add these checks before creating memory
                    await this.runtime.ensureRoomExists(roomId);
                    await this.runtime.ensureUserExists(
                        stringToUuid(tweet.userId),
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );
                    await this.runtime.ensureParticipantInRoom(
                        this.runtime.agentId,
                        roomId
                    );

                    // Then create the memory
                    await this.runtime.messageManager.createMemory({
                        id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                        userId: stringToUuid(tweet.userId),
                        content: {
                            text: tweet.text,
                            url: tweet.permanentUrl,
                            source: "twitter",
                            action: executedActions.join(","),
                        },
                        agentId: this.runtime.agentId,
                        roomId,
                        embedding: await this.generateEmbedding(tweet.text),
                        createdAt: tweet.timestamp * 1000,
                    });

                    results.push({
                        tweetId: tweet.id,
                        parsedActions: actionResponse,
                        executedActions
                    });

                } catch (error) {
                    elizaLogger.error(`Error processing tweet ${tweet.id}:`, error);
                    continue;
                }
            }

            return results; // Return results array to indicate completion

        } catch (error) {
            elizaLogger.error('Error in processTweetActions:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    private async handleTextOnlyReply(tweet: Tweet, tweetState: any, executedActions: string[]) {
        try {
            // Build conversation thread for context
            const thread = await buildConversationThread(tweet, this.client);
            const formattedConversation = thread
                .map((t) => `@${t.username} (${new Date(t.timestamp * 1000).toLocaleString()}): ${t.text}`)
                .join("\n\n");

            // Generate image descriptions if present
            const imageDescriptions = [];
            if (tweet.photos?.length > 0) {
                elizaLogger.log('Processing images in tweet for context');
                for (const photo of tweet.photos) {
                    const description = await this.runtime
                        .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                        .describeImage(photo.url);
                    imageDescriptions.push(description);
                }
            }

            // Handle quoted tweet if present
            let quotedContent = '';
            if (tweet.quotedStatusId) {
                try {
                    const quotedTweet = await this.client.twitterClient.getTweet(tweet.quotedStatusId);
                    if (quotedTweet) {
                        quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
                    }
                } catch (error) {
                    elizaLogger.error('Error fetching quoted tweet:', error);
                }
            }

            // Compose rich state with all context
            const enrichedState = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId: stringToUuid(tweet.conversationId + "-" + this.runtime.agentId),
                    agentId: this.runtime.agentId,
                    content: { text: tweet.text, action: "" }
                },
                {
                    twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                    currentPost: `From @${tweet.username}: ${tweet.text}`,
                    formattedConversation,
                    imageContext: imageDescriptions.length > 0
                        ? `\nImages in Tweet:\n${imageDescriptions.map((desc, i) => `Image ${i + 1}: ${desc}`).join('\n')}`
                        : '',
                    quotedContent,
                }
            );

            // Generate and clean the reply content
            const replyText = await this.generateTweetContent(enrichedState, {
                template: this.runtime.character.templates?.twitterMessageHandlerTemplate || twitterMessageHandlerTemplate
            });

            if (!replyText) {
                elizaLogger.error('Failed to generate valid reply content');
                return;
            }

            elizaLogger.debug('Final reply text to be sent:', replyText);

            // Send the tweet through request queue
            const result = await this.client.requestQueue.add(
                async () => await this.client.twitterClient.sendTweet(
                    replyText,
                    tweet.id
                )
            );

            const body = await result.json();

            if (body?.data?.create_tweet?.tweet_results?.result) {
                elizaLogger.log('Successfully posted reply tweet');
                executedActions.push('reply');

                // Cache generation context for debugging
                await this.runtime.cacheManager.set(
                    `twitter/reply_generation_${tweet.id}.txt`,
                    `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
                );
            } else {
                elizaLogger.error('Tweet reply creation failed:', body);
            }
        } catch (error) {
            elizaLogger.error('Error in handleTextOnlyReply:', error);
        }
    }

    async stop() {
        this.stopProcessingActions = true;
    }
}