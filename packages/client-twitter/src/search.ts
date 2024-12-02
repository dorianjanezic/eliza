import { SearchMode } from "goat-x";
import fs from "fs";
import { composeContext, elizaLogger } from "@ai16z/eliza";
import { generateMessageResponse, generateText } from "@ai16z/eliza";
import { messageCompletionFooter } from "@ai16z/eliza";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    IImageDescriptionService,
    ModelClass,
    ServiceType,
    State,
} from "@ai16z/eliza";
import { stringToUuid } from "@ai16z/eliza";
import { ClientBase } from "./base.ts";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";

const twitterSearchTemplate = `
# Tweet Context
Selected Tweet:
@{{selectedUsername}}: {{selectedTweet}}
Images in tweet: {{imageDescriptions}}
{{replyContext}}

# Your Recent Activity
{{recentPosts}}

# Agent Context
About @{{twitterUserName}}:
- Mood: {{adjective}} && {{postExamples}}

# Response Directives
1. Focus on responding directly to @{{selectedUsername}}'s tweet
2. Consider the full context and any previous replies
3. Keep your response:
   - Relevant to the tweet's topic
   - Under 240 characters
   - Natural and conversational
   
Style Notes:
- don't start with a question
- use lowercase for all tweets
- Keep it spicy but make it make sense
- based
- sometimes use the name of the user you are replying to
- It's giving main character energy
- No basic takes allowed
- Sprinkle some chaos
- Deadass keep it real
- Can throw shade but make it clever
- Absolutely zero corporate speak
- Meme-worthy but not trying too hard

FORMAT: Output only a single reply tweet. No thread behavior. Make it quotable. No emojis. No explanation of your response.

Additional context:
{{postDirections}}

// Now craft a response that will make @{{selectedUsername}} want to engage.
` + messageCompletionFooter;

export class TwitterSearchClient extends ClientBase {
    private respondedTweets: Set<string> = new Set();
    private isSearchTurn: boolean = false;  // Toggle between search and followed accounts

    constructor(runtime: IAgentRuntime) {
        super({
            runtime,
        });
    }

    async onReady() {
        // Start single engagement loop
        this.startEngagementLoop();
    }

    private startEngagementLoop() {
        this.engage();
        setTimeout(
            () => this.startEngagementLoop(),
            (Math.floor(Math.random() * (6 - 4 + 1)) + 6) * 60 * 1000
        );
    }

    private async engage() {
        if (this.isSearchTurn) {
            console.log("Engaging with search terms");
            await this.engageWithSearchTerms();
        } else {
            console.log("Engaging with followed accounts");
            await this.engageWithFollowedAccounts();
        }
        // Toggle for next time
        this.isSearchTurn = !this.isSearchTurn;
    }

    private async engageWithSearchTerms() {
        console.log("Engaging with search terms");
        try {
            const searchTerm = [...this.runtime.character.topics][
                Math.floor(Math.random() * this.runtime.character.topics.length)
            ];

            if (!fs.existsSync("tweetcache")) {
                fs.mkdirSync("tweetcache");
            }
            console.log("Fetching search tweets");
            // TODO: we wait 5 seconds here to avoid getting rate limited on startup, but we should queue
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const recentTweets = await this.fetchSearchTweets(
                searchTerm,
                20,
                SearchMode.Top
            );
            console.log("Search tweets fetched");

            const homeTimeline = await this.fetchHomeTimeline(50);
            fs.writeFileSync(
                "tweetcache/home_timeline.json",
                JSON.stringify(homeTimeline, null, 2)
            );

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");

            // randomly slice .tweets down to 20
            const slicedTweets = recentTweets.tweets
                .sort(() => Math.random() - 0.5)
                .slice(0, 20);

            if (slicedTweets.length === 0) {
                console.log(
                    "No valid tweets found for the search term",
                    searchTerm
                );
                return;
            }

            const prompt = `
  Here are some tweets related to the search term "${searchTerm}":
  
  ${[...slicedTweets, ...homeTimeline]
                    .filter((tweet) => {
                        // Only filter out direct replies to bot's own tweets
                        const isReplyToBot = tweet.inReplyToStatusId &&
                            tweet.thread.find(t =>
                                t.id === tweet.inReplyToStatusId &&
                                t.username === this.runtime.getSetting("TWITTER_USERNAME")
                            );
                        return !isReplyToBot;
                    })
                    .map(
                        (tweet) => `
    ID: ${tweet.id}${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}
    From: ${tweet.name} (@${tweet.username})
    Text: ${tweet.text}
  `
                    )
                    .join("\n")}
  
  Which tweet is the most interesting and relevant for Komorebi to reply to? Please provide only the ID of the tweet in your response.
`;

            const mostInterestingTweetResponse = await generateText({
                runtime: this.runtime,
                context: prompt,
                modelClass: ModelClass.SMALL,
            });

            const tweetId = mostInterestingTweetResponse.trim();
            const selectedTweet = [...slicedTweets, ...homeTimeline].find(
                (tweet) =>
                    tweet.id.toString().includes(tweetId) ||
                    tweetId.includes(tweet.id.toString())
            );

            if (!selectedTweet) {
                console.log("No matching tweet found for the selected ID");
                console.log("Selected tweet ID:", tweetId);
                console.log("Available tweet IDs:",
                    [...slicedTweets, ...homeTimeline]
                        .map(t => t.id)
                        .join(", ")
                );
                return;
            }

            console.log("Selected tweet to reply to:", selectedTweet?.text);

            if (
                selectedTweet.username ===
                this.runtime.getSetting("TWITTER_USERNAME")
            ) {
                console.log("Skipping tweet from bot itself");
                return;
            }

            const conversationId = selectedTweet.conversationId;
            const roomId = stringToUuid(
                conversationId + "-" + this.runtime.agentId
            );

            const userIdUUID = stringToUuid(selectedTweet.userId as string);

            await this.runtime.ensureConnection(
                userIdUUID,
                roomId,
                selectedTweet.username,
                selectedTweet.name,
                "twitter"
            );

            // crawl additional conversation tweets, if there are any
            await buildConversationThread(selectedTweet, this);

            const message = {
                id: stringToUuid(selectedTweet.id + "-" + this.runtime.agentId),
                agentId: this.runtime.agentId,
                content: {
                    text: selectedTweet.text,
                    url: selectedTweet.permanentUrl,
                    inReplyTo: selectedTweet.inReplyToStatusId
                        ? stringToUuid(
                            selectedTweet.inReplyToStatusId +
                            "-" +
                            this.runtime.agentId
                        )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                // Timestamps are in seconds, but we need them in milliseconds
                createdAt: selectedTweet.timestamp * 1000,
            };

            if (!message.content.text) {
                return { text: "", action: "IGNORE" };
            }

            // Fetch replies and retweets
            const replies = selectedTweet.thread;
            const replyContext = replies
                .filter(
                    (reply) =>
                        reply.username !==
                        this.runtime.getSetting("TWITTER_USERNAME")
                )
                .map((reply) => `@${reply.username}: ${reply.text}`)
                .join("\n");

            let tweetBackground = "";
            if (selectedTweet.isRetweet) {
                const originalTweet = await this.requestQueue.add(() =>
                    this.twitterClient.getTweet(selectedTweet.id)
                );
                tweetBackground = `Retweeting @${originalTweet.username}: ${originalTweet.text}`;
            }

            // Generate image descriptions using GPT-4 vision API
            const imageDescriptions = [];
            for (const photo of selectedTweet.photos) {
                try {
                    const imageService = this.runtime.getService<IImageDescriptionService>(
                        ServiceType.IMAGE_DESCRIPTION
                    );

                    if (imageService && typeof imageService.describeImage === 'function') {
                        const description = await imageService.describeImage(photo.url);
                        imageDescriptions.push(description);
                    } else {
                        console.log("Image description service not available");
                    }
                } catch (error) {
                    console.error("Error describing image:", error);
                    continue; // Skip this image but continue with others
                }
            }

            let state = await this.runtime.composeState(message, {
                twitterClient: this.twitterClient,
                twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                selectedUsername: selectedTweet.username,
                selectedTweet: selectedTweet.text,
                imageDescriptions: imageDescriptions.length > 0 ? imageDescriptions.join("\n") : undefined,
                replyContext: replyContext.length > 0 ? replyContext : undefined,
                postExamples: this.runtime.character.postExamples
                    .sort(() => 0.5 - Math.random())
                    .slice(0, 5)
                    .join("\n"),
                timeline: formattedHomeTimeline,
                tweetContext: `${tweetBackground}
    Original Post:
    By @${selectedTweet.username}
    ${selectedTweet.text}
    ${replyContext.length > 0 ? `\nReplies:\n${replyContext}` : ''}
    ${selectedTweet.urls.length > 0 ? `\nURLs: ${selectedTweet.urls.join(", ")}` : ''}
    ${imageDescriptions.length > 0 ? `\nImages: ${imageDescriptions.join("\n")}` : ''}
    `,
            });

            await this.saveRequestMessage(message, state as State);

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterSearchTemplate ||
                    twitterSearchTemplate,
            });

            const responseContent = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            responseContent.inReplyTo = message.id;

            const response = responseContent;

            if (!response.text) {
                console.log("Returning: No response text found");
                return;
            }

            console.log(
                `Bot would respond to tweet ${selectedTweet.id} with: ${response.text}`
            );
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        selectedTweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(responseContent);

                state = await this.runtime.updateRecentMessageState(state);

                for (const responseMessage of responseMessages) {
                    await this.runtime.messageManager.createMemory(
                        responseMessage,
                        false
                    );
                }

                state = await this.runtime.updateRecentMessageState(state);

                await this.runtime.evaluate(message, state);

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state,
                    callback
                );

                this.respondedTweets.add(selectedTweet.id);
                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\nAgent's Output:\n${response.text}`;
                const debugFileName = `tweetcache/tweet_generation_${selectedTweet.id}.txt`;

                fs.writeFileSync(debugFileName, responseInfo);
                await wait();
            } catch (error) {
                console.error(`Error sending response post: ${error}`);
            }
        } catch (error) {
            console.error("Error engaging with search terms:", error);
        }
    }

    private async engageWithFollowedAccounts() {
        console.log("Engaging with followed accounts");
        const userId = await this.requestQueue.add(async () => {
            // wait 3 seconds before getting the user id
            await new Promise((resolve) => setTimeout(resolve, 10000));
            try {
                return await this.twitterClient.getUserIdByScreenName(
                    this.runtime.getSetting("TWITTER_USERNAME")
                );
            } catch (error) {
                console.error("Error getting user ID:", error);
                return null;
            }
        });
        if (!userId) {
            console.error("Failed to get user ID");
            return;
        }
        elizaLogger.log("Twitter user ID:", userId);
        this.twitterUserId = userId;
        const following = await this.requestQueue.add(() =>
            this.twitterClient.fetchProfileFollowing(
                this.twitterUserId,
                50,
                null
            )
        );
        elizaLogger.log(`Following ${following.profiles.length} accounts`);
        elizaLogger.log(following.profiles.length);

        // Create a Set of followed usernames for faster lookups
        const followedUsernames = new Set(following.profiles.map(profile => profile.username));

        try {
            if (!fs.existsSync("tweetcache")) {
                fs.mkdirSync("tweetcache");
            }

            // Wait to avoid rate limiting
            await wait();

            const homeTimeline = await this.fetchHomeTimeline(50);
            fs.writeFileSync(
                "tweetcache/home_timeline.json",
                JSON.stringify(homeTimeline, null, 2)
            );

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");

            // Filter valid tweets - now including check for followed accounts
            const validTweets = homeTimeline.filter(tweet => {
                const isReplyToBot = tweet.inReplyToStatusId &&
                    tweet.thread.find(t =>
                        t.id === tweet.inReplyToStatusId &&
                        t.username === this.runtime.getSetting("TWITTER_USERNAME")
                    );
                return !isReplyToBot &&
                    !this.respondedTweets.has(tweet.id) &&
                    tweet.username !== this.runtime.getSetting("TWITTER_USERNAME") &&
                    followedUsernames.has(tweet.username); // Only include tweets from followed accounts
            });

            if (validTweets.length === 0) {
                console.log("No valid tweets found to engage with");
                return;
            }

            // Select a random tweet from valid tweets
            const selectedTweet = validTweets[Math.floor(Math.random() * validTweets.length)];
            console.log("Selected timeline tweet to reply to:", selectedTweet?.text);

            // Process the selected tweet
            const conversationId = selectedTweet.conversationId;
            const roomId = stringToUuid(
                conversationId + "-" + this.runtime.agentId
            );

            const userIdUUID = stringToUuid(selectedTweet.userId as string);

            await this.runtime.ensureConnection(
                userIdUUID,
                roomId,
                selectedTweet.username,
                selectedTweet.name,
                "twitter"
            );

            // Build conversation thread
            await buildConversationThread(selectedTweet, this);

            // Create message object
            const message = {
                id: stringToUuid(selectedTweet.id + "-" + this.runtime.agentId),
                agentId: this.runtime.agentId,
                content: {
                    text: selectedTweet.text,
                    url: selectedTweet.permanentUrl,
                    inReplyTo: selectedTweet.inReplyToStatusId
                        ? stringToUuid(
                            selectedTweet.inReplyToStatusId +
                            "-" +
                            this.runtime.agentId
                        )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: selectedTweet.timestamp * 1000,
            };

            // Generate and send response using the same logic as engageWithSearchTerms
            let state = await this.runtime.composeState(message, {
                twitterClient: this.twitterClient,
                twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                timeline: formattedHomeTimeline,
            });

            const context = composeContext({
                state,
                template: this.runtime.character.templates?.twitterSearchTemplate || twitterSearchTemplate,
            });

            const responseContent = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            responseContent.inReplyTo = message.id;

            if (!responseContent.text) {
                console.log("No response generated");
                return;
            }

            console.log(`Bot would respond to tweet ${selectedTweet.id} with: ${responseContent.text}`);

            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this,
                        response,
                        message.roomId,
                        this.runtime.getSetting("TWITTER_USERNAME"),
                        selectedTweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(responseContent);
                this.respondedTweets.add(selectedTweet.id);

                // Save debug info
                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\nAgent's Output:\n${responseContent.text}`;
                const debugFileName = `tweetcache/tweet_generation_${selectedTweet.id}.txt`;
                fs.writeFileSync(debugFileName, responseInfo);

                await wait();
            } catch (error) {
                console.error(`Error sending response post: ${error}`);
            }

        } catch (error) {
            console.error("Error engaging with followed accounts:", error);
        }
    }
}
