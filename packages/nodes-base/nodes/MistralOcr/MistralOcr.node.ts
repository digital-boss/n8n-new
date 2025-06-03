import chunk from 'lodash/chunk';
import FormData from 'form-data';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { document } from './descriptions';
import { encodeBinaryData, mistralApiRequest } from './GenericFunctions';
import type { BatchItemResult, BatchJob, Page } from './types';

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
		const resource = this.getNodeParameter('resource', 0);
		const operation = this.getNodeParameter('operation', 0);

		if (resource === 'document') {
			if (operation === 'extractText') {
				const enableBatch = this.getNodeParameter('batch', 0, false) as boolean;

				if (enableBatch) {
					try {
						const model = this.getNodeParameter('model', 0) as string;
						const batchSize = this.getNodeParameter('batchSize', 0, 50) as number;

						const itemsWithIndex = items.map((item, index) => ({
							...item,
							index,
						}));

						const fileIds = [];
						for (const batch of chunk(itemsWithIndex, batchSize)) {
							const entries = [];
							for (const item of batch) {
								const documentType = this.getNodeParameter('documentType', item.index) as
									| 'document_url'
									| 'image_url';
								const { dataUrl, fileName } = await encodeBinaryData.call(this, item.index);

								entries.push({
									custom_id: item.index.toString(),
									body: {
										document: {
											type: documentType,
											document_name: fileName,
											[documentType]: dataUrl,
										},
									},
								});
							}

							const formData = new FormData();
							formData.append(
								'file',
								Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n')),
								{
									filename: 'batch_file.jsonl',
									contentType: 'application/json',
								},
							);
							formData.append('purpose', 'batch');

							const fileResponse = await mistralApiRequest.call(
								this,
								'POST',
								'/v1/files',
								formData,
							);
							fileIds.push(fileResponse.id);
						}

						const jobIds = [];
						for (const fileId of fileIds) {
							const body: IDataObject = {
								model,
								input_files: [fileId],
								endpoint: '/v1/ocr',
							};

							jobIds.push((await mistralApiRequest.call(this, 'POST', '/v1/batch/jobs', body)).id);
						}

						const jobResults: BatchJob[] = [];
						for (const jobId of jobIds) {
							let job = (await mistralApiRequest.call(
								this,
								'GET',
								`/v1/batch/jobs/${jobId}`,
							)) as BatchJob;
							while (job.status === 'QUEUED' || job.status === 'RUNNING') {
								await new Promise((resolve) => setTimeout(resolve, 2000));
								job = (await mistralApiRequest.call(
									this,
									'GET',
									`/v1/batch/jobs/${jobId}`,
								)) as BatchJob;
							}
							jobResults.push(job);
						}

						for (const jobResult of jobResults) {
							if (jobResult.status !== 'SUCCESS' || jobResult.errors.length) {
								// Todo: handle errors
							} else {
								const fileResponse = (await mistralApiRequest.call(
									this,
									'GET',
									`/v1/files/${jobResult.output_file}/content`,
								)) as string;
								const batchResult: BatchItemResult[] = fileResponse
									.trim()
									.split('\n')
									.map((json) => JSON.parse(json));

								for (const result of batchResult) {
									const index = parseInt(result.custom_id);
									if (result.error) {
										const executionData = this.helpers.constructExecutionMetaData(
											this.helpers.returnJsonArray({ error: result.error }),
											{ itemData: { item: index } },
										);
										returnData.push(...executionData);
									}
									// Todo: use common function if any modification to response body needs to be made
									const data = {
										...result.response.body,
										extractedText: result.response.body.pages
											.map((page) => page.markdown)
											.join('\n\n'),
										pageCount: result.response.body.pages.length,
									};
									const executionData = this.helpers.constructExecutionMetaData(
										this.helpers.returnJsonArray(data),
										{ itemData: { item: index } },
									);
									returnData.push(...executionData);
								}
							}
						}
					} catch (error) {
						// Todo: handle error
						throw error;
					}
				} else {
					let responseData: IDataObject;

					for (let i = 0; i < items.length; i++) {
						try {
							const model = this.getNodeParameter('model', i) as string;
							const inputType = this.getNodeParameter('inputType', i) as 'binary' | 'url';
							const documentType = this.getNodeParameter('documentType', i) as
								| 'document_url'
								| 'image_url';

							if (inputType === 'binary') {
								const { dataUrl, fileName } = await encodeBinaryData.call(this, i);

								const body: IDataObject = {
									model,
									document: {
										type: documentType,
										document_name: fileName,
										[documentType]: dataUrl,
									},
								};

								responseData = (await mistralApiRequest.call(
									this,
									'POST',
									'/v1/ocr',
									body,
								)) as IDataObject;

								// Todo: use common function if any modification to response body needs to be made
								const pages = responseData.pages as Array<{ markdown: string; text: string }>;
								responseData.extractedText = pages.map((page) => page.markdown).join('\n\n');
								responseData.pageCount = pages.length;
							} else {
								const url = this.getNodeParameter('url', i) as string;

								const body: IDataObject = {
									model,
									document: {
										type: documentType,
										[documentType]: url,
									},
								};

								responseData = (await mistralApiRequest.call(
									this,
									'POST',
									'/v1/ocr',
									body,
								)) as IDataObject;

								// Todo: use common function if any modification to response body needs to be made
								const pages = responseData.pages as Page[];
								responseData.extractedText = pages.map((page) => page.markdown).join('\n\n');
								responseData.pageCount = pages.length;
							}

							const executionData = this.helpers.constructExecutionMetaData(
								this.helpers.returnJsonArray(responseData),
								{ itemData: { item: i } },
							);
							returnData.push(...executionData);
						} catch (error) {
							if (this.continueOnFail()) {
								const executionErrorData = this.helpers.constructExecutionMetaData(
									this.helpers.returnJsonArray({ error: error.message }),
									{ itemData: { item: i } },
								);
								returnData.push(...executionErrorData);
								continue;
							}
							throw error;
						}
					}
				}
			}
		}

		return [returnData];
	}
}
