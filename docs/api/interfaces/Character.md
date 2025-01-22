[@ai16z/eliza v0.1.5-alpha.3](../index.md) / Character

# Interface: Character

Configuration for an agent character

## Properties

### id?

> `optional` **id**: \`$\{string\}-$\{string\}-$\{string\}-$\{string\}-$\{string\}\`

Optional unique identifier

#### Defined in

[packages/core/src/types.ts:611](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L611)

***

### name

> **name**: `string`

Character name

#### Defined in

[packages/core/src/types.ts:614](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L614)

***

### username?

> `optional` **username**: `string`

Optional username

#### Defined in

[packages/core/src/types.ts:617](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L617)

***

### system?

> `optional` **system**: `string`

Optional system prompt

#### Defined in

[packages/core/src/types.ts:620](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L620)

***

### modelProvider

> **modelProvider**: [`ModelProviderName`](../enumerations/ModelProviderName.md)

Model provider to use

#### Defined in

[packages/core/src/types.ts:623](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L623)

***

### imageModelProvider?

> `optional` **imageModelProvider**: [`ModelProviderName`](../enumerations/ModelProviderName.md)

Image model provider to use, if different from modelProvider

#### Defined in

[packages/core/src/types.ts:626](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L626)

***

### modelEndpointOverride?

> `optional` **modelEndpointOverride**: `string`

Optional model endpoint override

#### Defined in

[packages/core/src/types.ts:629](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L629)

***

### templates?

> `optional` **templates**: `object`

Optional prompt templates

#### goalsTemplate?

> `optional` **goalsTemplate**: `string`

#### factsTemplate?

> `optional` **factsTemplate**: `string`

#### messageHandlerTemplate?

> `optional` **messageHandlerTemplate**: `string`

#### shouldRespondTemplate?

> `optional` **shouldRespondTemplate**: `string`

#### continueMessageHandlerTemplate?

> `optional` **continueMessageHandlerTemplate**: `string`

#### evaluationTemplate?

> `optional` **evaluationTemplate**: `string`

#### twitterSearchTemplate?

> `optional` **twitterSearchTemplate**: `string`

#### twitterPostTemplate?

> `optional` **twitterPostTemplate**: `string`

#### twitterActionTemplate?

> `optional` **twitterActionTemplate**: `string`

#### twitterMessageHandlerTemplate?

> `optional` **twitterMessageHandlerTemplate**: `string`

#### twitterShouldRespondTemplate?

> `optional` **twitterShouldRespondTemplate**: `string`

#### farcasterPostTemplate?

> `optional` **farcasterPostTemplate**: `string`

#### farcasterMessageHandlerTemplate?

> `optional` **farcasterMessageHandlerTemplate**: `string`

#### farcasterShouldRespondTemplate?

> `optional` **farcasterShouldRespondTemplate**: `string`

#### telegramMessageHandlerTemplate?

> `optional` **telegramMessageHandlerTemplate**: `string`

#### telegramShouldRespondTemplate?

> `optional` **telegramShouldRespondTemplate**: `string`

#### discordVoiceHandlerTemplate?

> `optional` **discordVoiceHandlerTemplate**: `string`

#### discordShouldRespondTemplate?

> `optional` **discordShouldRespondTemplate**: `string`

#### discordMessageHandlerTemplate?

> `optional` **discordMessageHandlerTemplate**: `string`

#### Defined in

[packages/core/src/types.ts:632](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L632)

***

### bio

> **bio**: `string` \| `string`[]

Character biography

#### Defined in

[packages/core/src/types.ts:655](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L655)

***

### lore

> **lore**: `string`[]

Character background lore

#### Defined in

[packages/core/src/types.ts:658](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L658)

***

### messageExamples

> **messageExamples**: [`MessageExample`](MessageExample.md)[][]

Example messages

#### Defined in

[packages/core/src/types.ts:661](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L661)

***

### postExamples

> **postExamples**: `string`[]

Example posts

#### Defined in

[packages/core/src/types.ts:664](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L664)

***

### topics

> **topics**: `string`[]

Known topics

#### Defined in

[packages/core/src/types.ts:667](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L667)

***

### adjectives

> **adjectives**: `string`[]

Character traits

#### Defined in

[packages/core/src/types.ts:670](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L670)

***

### knowledge?

> `optional` **knowledge**: `string`[]

Optional knowledge base

#### Defined in

[packages/core/src/types.ts:673](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L673)

***

### clients

> **clients**: [`Clients`](../enumerations/Clients.md)[]

Supported client platforms

#### Defined in

[packages/core/src/types.ts:676](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L676)

***

### plugins

> **plugins**: [`Plugin`](../type-aliases/Plugin.md)[]

Available plugins

#### Defined in

[packages/core/src/types.ts:679](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L679)

***

### settings?

> `optional` **settings**: `object`

Optional configuration

#### secrets?

> `optional` **secrets**: `object`

##### Index Signature

 \[`key`: `string`\]: `string`

#### buttplug?

> `optional` **buttplug**: `boolean`

#### voice?

> `optional` **voice**: `object`

#### voice.model?

> `optional` **model**: `string`

#### voice.url?

> `optional` **url**: `string`

#### voice.elevenlabs?

> `optional` **elevenlabs**: `object`

#### voice.elevenlabs.voiceId

> **voiceId**: `string`

New structured ElevenLabs config

#### voice.elevenlabs.model?

> `optional` **model**: `string`

#### voice.elevenlabs.stability?

> `optional` **stability**: `string`

#### voice.elevenlabs.similarityBoost?

> `optional` **similarityBoost**: `string`

#### voice.elevenlabs.style?

> `optional` **style**: `string`

#### voice.elevenlabs.useSpeakerBoost?

> `optional` **useSpeakerBoost**: `string`

#### model?

> `optional` **model**: `string`

#### embeddingModel?

> `optional` **embeddingModel**: `string`

#### chains?

> `optional` **chains**: `object`

##### Index Signature

 \[`key`: `string`\]: `any`[]

#### chains.evm?

> `optional` **evm**: `any`[]

#### chains.solana?

> `optional` **solana**: `any`[]

#### Defined in

[packages/core/src/types.ts:682](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L682)

***

### clientConfig?

> `optional` **clientConfig**: `object`

Optional client-specific config

#### discord?

> `optional` **discord**: `object`

#### discord.shouldIgnoreBotMessages?

> `optional` **shouldIgnoreBotMessages**: `boolean`

#### discord.shouldIgnoreDirectMessages?

> `optional` **shouldIgnoreDirectMessages**: `boolean`

#### telegram?

> `optional` **telegram**: `object`

#### telegram.shouldIgnoreBotMessages?

> `optional` **shouldIgnoreBotMessages**: `boolean`

#### telegram.shouldIgnoreDirectMessages?

> `optional` **shouldIgnoreDirectMessages**: `boolean`

#### Defined in

[packages/core/src/types.ts:708](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L708)

***

### style

> **style**: `object`

Writing style guides

#### all

> **all**: `string`[]

#### chat

> **chat**: `string`[]

#### post

> **post**: `string`[]

#### Defined in

[packages/core/src/types.ts:720](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L720)

***

### twitterProfile?

> `optional` **twitterProfile**: `object`

Optional Twitter profile

#### id

> **id**: `string`

#### username

> **username**: `string`

#### screenName

> **screenName**: `string`

#### bio

> **bio**: `string`

#### nicknames?

> `optional` **nicknames**: `string`[]

#### Defined in

[packages/core/src/types.ts:727](https://github.com/dorianjanezic/eliza/blob/main/packages/core/src/types.ts#L727)
