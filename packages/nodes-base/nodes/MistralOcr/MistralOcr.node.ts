import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
	IHttpRequestOptions,
	IExecuteSingleFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { document } from './descriptions';
import { handleBinaryData, processResponseData, sendErrorPostReceive } from './GenericFunctions';
import type { IRequestBody } from './types';

export class MistralOcr implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Mistral OCR',
		name: 'mistralOcr',
		icon: {
			light: 'file:mistralOcr.svg',
			dark: 'file:mistralOcr.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: "Extract text and layout information from documents using Mistral's OCR API",
		defaults: {
			name: 'Mistral OCR',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'mistralCloudApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: 'https://api.mistral.ai',
			ignoreHttpStatusErrors: true,
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Document',
						value: 'document',
					},
				],
				default: 'document',
			},
			...document.description,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const enableBatchProcessing = this.getNodeParameter('enableBatchProcessing', 0) as boolean;
		const batchSize = enableBatchProcessing ? (this.getNodeParameter('batchSize', 0) as number) : 0;

		if (!enableBatchProcessing) {
			for (let i = 0; i < items.length; i++) {
				const model = this.getNodeParameter('model', i) as string;
				const inputType = this.getNodeParameter('inputType', i) as string;

				let body: any;

				if (inputType === 'binary') {
					const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
					body = await handleBinaryData(this.helpers, items[i], i, binaryProperty, model);
				} else if (inputType === 'url') {
					const documentUrl = this.getNodeParameter('documentUrl', i) as string;
					if (!documentUrl) {
						throw new NodeOperationError(
							this.getNode(),
							`Document URL must be provided for item ${i}`,
						);
					}

					body = {
						model,
						document: {
							type: 'document_url',
							document_url: documentUrl,
						},
					};
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported input type: ${inputType}`);
				}

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.mistral.ai/v1/ocr',
					headers: { 'Content-Type': 'application/json' },
					body,
					json: true,
				};

				const response = await this.helpers.requestWithAuthentication.call(
					this,
					'mistralCloudApi',
					requestOptions,
				);

				await sendErrorPostReceive.call(
					this as unknown as IExecuteSingleFunctions,
					[items[i]],
					response,
				);

				const processedItems = await processResponseData.call(
					this as unknown as IExecuteSingleFunctions,
					[items[i]],
					response,
				);

				returnData.push(processedItems[0]);
			}
		} else {
			// Batch processing mode
			if (!batchSize || batchSize < 1) {
				throw new NodeOperationError(this.getNode(), 'Batch size must be greater than zero');
			}

			for (let start = 0; start < items.length; start += batchSize) {
				const batchItems = items.slice(start, start + batchSize);
				const model = this.getNodeParameter('model', 0) as string;

				// Build array of documents for the batch request
				const documents = await Promise.all(
					batchItems.map(async (item, i) => {
						const idx = start + i;
						const inputType = this.getNodeParameter('inputType', idx) as string;

						if (inputType === 'binary') {
							const binaryProperty = this.getNodeParameter('binaryProperty', idx) as string;
							const body = (await handleBinaryData(
								this.helpers,
								item,
								idx,
								binaryProperty,
								model,
							)) as IRequestBody;
							if (!body.document) {
								throw new NodeOperationError(this.getNode(), `Invalid binary data for item ${idx}`);
							}
							return body.document;
						} else if (inputType === 'url') {
							const documentUrl = this.getNodeParameter('documentUrl', idx) as string;
							if (!documentUrl) {
								throw new NodeOperationError(
									this.getNode(),
									`Document URL must be provided for item ${idx}`,
								);
							}
							return {
								type: 'document_url',
								document_url: documentUrl,
							};
						} else {
							throw new NodeOperationError(this.getNode(), `Unsupported input type: ${inputType}`);
						}
					}),
				);

				const body = {
					model,
					documents,
				};

				const requestOptions: IHttpRequestOptions = {
					method: 'POST',
					url: 'https://api.mistral.ai/v1/ocr',
					headers: { 'Content-Type': 'application/json' },
					body,
					json: true,
				};

				const response = await this.helpers.requestWithAuthentication.call(
					this,
					'mistralCloudApi',
					requestOptions,
				);

				await sendErrorPostReceive.call(
					this as unknown as IExecuteSingleFunctions,
					batchItems,
					response,
				);

				// The API returns an array of responses matching each document in the batch
				const responseDataArray = response.body as any[];
				if (!Array.isArray(responseDataArray) || responseDataArray.length !== documents.length) {
					throw new NodeOperationError(this.getNode(), 'Batch response length mismatch');
				}

				for (let j = 0; j < batchItems.length; j++) {
					const processedItems = await processResponseData.call(
						this as unknown as IExecuteSingleFunctions,
						[batchItems[j]],
						{
							...response,
							body: responseDataArray[j],
						},
					);
					returnData.push(processedItems[0]);
				}
			}
		}

		return [returnData];
	}
}
