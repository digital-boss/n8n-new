import type {
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { document } from './descriptions';

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
		const results: INodeExecutionData[] = [];

		const enableBatch = this.getNodeParameter('enableBatchProcessing', 0, false) as boolean;
		const batchSize = this.getNodeParameter('batchSize', 0, 25) as number;
		const model = this.getNodeParameter('model', 0) as string;
		const inputType = this.getNodeParameter('inputType', 0) as string;

		const endpoint = '/v1/ocr/batch';

		function chunkArrayWithIndex(
			array: INodeExecutionData[],
			size: number,
		): Array<{ batch: INodeExecutionData[]; indexes: number[] }> {
			const result: Array<{ batch: INodeExecutionData[]; indexes: number[] }> = [];
			for (let i = 0; i < array.length; i += size) {
				result.push({
					batch: array.slice(i, i + size),
					indexes: Array.from({ length: Math.min(size, array.length - i) }, (_, k) => i + k),
				});
			}
			return result;
		}

		const batches = enableBatch
			? chunkArrayWithIndex(items, batchSize)
			: items.map((item, idx) => ({ batch: [item], indexes: [idx] }));

		for (const { batch, indexes } of batches) {
			const documents: any[] = [];

			for (let i = 0; i < batch.length; i++) {
				const item = batch[i];
				const itemIndex = indexes[i];

				try {
					if (inputType === 'binary') {
						const binaryProperty = this.getNodeParameter(
							'binaryProperty',
							itemIndex,
							'data',
						) as string;
						this.helpers.assertBinaryData(itemIndex, binaryProperty);
						const binaryDataBuffer = await this.helpers.getBinaryDataBuffer(
							itemIndex,
							binaryProperty,
						);
						const base64Data = binaryDataBuffer.toString('base64');
						const binaryData = item.binary![binaryProperty];

						documents.push({
							type: 'document_url',
							document_url: `data:${binaryData.mimeType};base64,${base64Data}`,
							include_image_base64: true,
						});
					} else if (inputType === 'url') {
						const documentUrl = this.getNodeParameter('documentUrl', itemIndex) as string;
						if (!documentUrl) {
							throw new NodeOperationError(
								this.getNode(),
								`Document URL is required for item at index ${itemIndex}`,
							);
						}

						let url = documentUrl;
						if (!url.startsWith('http://') && !url.startsWith('https://')) {
							url = `https://${url}`;
						}

						try {
							new URL(url);
							documents.push({
								type: 'document_url',
								document_url: url,
								include_image_base64: true,
							});
						} catch (error) {
							throw new NodeOperationError(
								this.getNode(),
								`Invalid document URL at index ${itemIndex}: "${documentUrl}". Please provide a valid URL.`,
							);
						}
					}
				} catch (error) {
					if (error instanceof NodeOperationError) {
						throw error;
					}
					throw new NodeOperationError(
						this.getNode(),
						`Error processing item at index ${itemIndex}: ${error.message}`,
					);
				}
			}

			if (documents.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No valid documents to process. Please check your input data.',
				);
			}

			const body = {
				model,
				documents,
				include_image_base64: true,
			};

			try {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'mistralCloudApi',
					{
						method: 'POST',
						url: endpoint,
						headers: {
							'Content-Type': 'application/json',
							Accept: 'application/json',
						},
						body,
						json: true,
					},
				);

				if (response.results && Array.isArray(response.results)) {
					for (let i = 0; i < response.results.length; i++) {
						const result = response.results[i];
						const originalItem = batch[i];
						const newItem = { ...originalItem };

						newItem.json = {
							...newItem.json,
							ocrResult: result,
							responseStatusCode: response.statusCode,
						};

						if (result.text) {
							newItem.json.extractedText = result.text;
						} else if (result.pages) {
							const pages = result.pages as Array<{ markdown: string; text: string }>;
							newItem.json.extractedText = pages
								.map((page) => page.markdown || page.text || '')
								.join('\n\n');
							newItem.json.pageCount = pages.length;
						}

						results.push(newItem);
					}
				} else {
					const newItem = { ...batch[0] };
					newItem.json = {
						...newItem.json,
						ocrResult: response,
						responseStatusCode: response.statusCode,
					};

					if (response.text) {
						newItem.json.extractedText = response.text;
					} else if (response.pages) {
						const pages = response.pages as Array<{ markdown: string; text: string }>;
						newItem.json.extractedText = pages
							.map((page) => page.markdown || page.text || '')
							.join('\n\n');
						newItem.json.pageCount = pages.length;
					}

					results.push(newItem);
				}
			} catch (error) {
				throw new NodeOperationError(this.getNode(), `Error processing request: ${error.message}`);
			}
		}

		return [results];
	}
}
